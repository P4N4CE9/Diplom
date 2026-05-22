from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text
from app.database import engine, Base, SessionLocal
from app.routes import parts, orders, clients, admin, compatibility, auth_routes
from app.models import AppUser
from app.auth import get_password_hash
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Создание таблиц
Base.metadata.create_all(bind=engine)


def relax_part_fk_for_order_history():
    """
    Разрешает удалять товары, не ломая историю заказов:
    позиции заказа продолжают хранить id товара даже после его удаления.
    """
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as conn:
        constraint_names = conn.execute(text("""
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_attribute att
              ON att.attrelid = rel.oid
             AND att.attnum = ANY (con.conkey)
            WHERE con.contype = 'f'
              AND rel.relname = 'позиции_заказа'
              AND att.attname = 'id_запчасти'
        """)).scalars().all()

        for constraint_name in constraint_names:
            escaped_name = constraint_name.replace('"', '""')
            conn.execute(text(
                f'ALTER TABLE "позиции_заказа" DROP CONSTRAINT IF EXISTS "{escaped_name}"'
            ))


relax_part_fk_for_order_history()

_onec_export = os.getenv("ONEC_ORDER_EXPORT_DIR", "").strip()
if _onec_export:
    print(f"[OK] ONEC_ORDER_EXPORT_DIR={_onec_export}")
else:
    print(
        "[--] ONEC_ORDER_EXPORT_DIR не задан — JSON для 1С не пишется. "
        f"Добавьте в {BASE_DIR / '.env'} строку ONEC_ORDER_EXPORT_DIR=C:\\\\путь\\\\к\\\\папке"
    )


def seed_first_admin():
    """Если в БД нет администратора — создаётся первая учётная запись (пароль только в виде bcrypt-хеша)."""
    db = SessionLocal()
    try:
        if db.query(AppUser).filter(AppUser.is_admin.is_(True)).first():
            return
        email = os.getenv("FIRST_ADMIN_EMAIL", "admin@shop.local").strip().lower()
        password = os.getenv("FIRST_ADMIN_PASSWORD", "admin123")
        db.add(
            AppUser(
                email=email,
                hashed_password=get_password_hash(password),
                full_name="Администратор",
                is_admin=True,
                is_active=True,
            )
        )
        db.commit()
        print(f"[OK] Создан первый администратор: {email} (смените пароль через FIRST_ADMIN_PASSWORD в .env)")
    finally:
        db.close()


seed_first_admin()

app = FastAPI(
    title="API магазина автозапчастей",
    description="REST API для управления магазином автозапчастей",
    version="1.0.0"
)


class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Путь к фронтенду (Vite: сборка в frontend/dist)
FRONTEND_PATH = (BASE_DIR / ".." / "frontend").resolve()
DIST_PATH = FRONTEND_PATH / "dist"
DIST_ASSETS = DIST_PATH / "assets"

if DIST_ASSETS.exists():
    app.mount("/assets", NoCacheStaticFiles(directory=str(DIST_ASSETS)), name="vite_assets")
    print(f"[OK] Vite assets: {DIST_ASSETS}")

# Легаси: папки css/js если остались
if (FRONTEND_PATH / "css").exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_PATH / "css")), name="css")
if (FRONTEND_PATH / "js").exists():
    app.mount("/js", StaticFiles(directory=str(FRONTEND_PATH / "js")), name="js")

if FRONTEND_PATH.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_PATH)), name="static")

# Монтируем папку с загруженными изображениями
UPLOAD_DIR = BASE_DIR / "uploads" / "images"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

if (BASE_DIR / "uploads").exists():
    app.mount("/uploads", NoCacheStaticFiles(directory=str(BASE_DIR / "uploads")), name="uploads")
    print(f"[OK] Uploads mounted from: {BASE_DIR / 'uploads'}")

if UPLOAD_DIR.exists():
    app.mount("/images", NoCacheStaticFiles(directory=str(UPLOAD_DIR)), name="images")
    print(f"[OK] Images mounted from: {UPLOAD_DIR}")

# Подключение роутеров
app.include_router(auth_routes.router)
app.include_router(parts.router)
app.include_router(orders.router)
app.include_router(clients.router)
app.include_router(admin.router)
app.include_router(compatibility.router)


@app.get("/")
async def read_root():
    dist_index = DIST_PATH / "index.html"
    if dist_index.exists():
        return FileResponse(
            str(dist_index),
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return {
        "message": "Соберите фронтенд: cd frontend && npm install && npm run build",
        "docs": "/docs",
        "api": "Работает. Для UI нужна папка frontend/dist",
    }


@app.get("/health")
def health_check():
    d = os.getenv("ONEC_ORDER_EXPORT_DIR", "").strip()
    return {
        "status": "ok",
        "onec_export_dir_set": bool(d),
        "onec_export_dir": d if d else None,
    }
