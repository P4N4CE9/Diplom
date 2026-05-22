from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text
from sqlalchemy.exc import SQLAlchemyError
from typing import Optional, List
from app.database import get_db
from app import models, schemas, auth
from decimal import Decimal
import os
import shutil
from pathlib import Path

router = APIRouter(prefix="/api/parts", tags=["parts"])

BASE_DIR = Path(__file__).parent.parent.parent
IMAGES_DIR = BASE_DIR / "uploads" / "images"
PRODUCT_IMAGES_DIR = IMAGES_DIR / "product"
CATEGORY_IMAGES_DIR = IMAGES_DIR / "categories"

PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
CATEGORY_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"]


def find_product_image(part_id: int) -> Optional[str]:
    """Возвращает публичный путь к изображению товара, если файл существует."""
    for ext in IMAGE_EXTENSIONS:
        image_path = PRODUCT_IMAGES_DIR / f"{part_id}.{ext}"
        if image_path.exists():
            return f"/uploads/images/product/{part_id}.{ext}"
    return None


def ensure_part_delete_does_not_break_orders(db: Session) -> None:
    """
    Убирает FK позиции_заказа -> запчасть, чтобы товар можно было удалить,
    не удаляя историю заказов.
    """
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return

    constraint_names = db.execute(text("""
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
        db.execute(text(
            f'ALTER TABLE "позиции_заказа" DROP CONSTRAINT IF EXISTS "{escaped_name}"'
        ))


@router.get("/", response_model=List[schemas.ЗапчастьСОстатком])
def get_parts(
        category: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db)
):
    """Получить список запчастей с фильтрацией и поиском"""
    query = db.query(models.Запчасть)

    if category:
        query = query.filter(models.Запчасть.категория == category)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                models.Запчасть.название.ilike(search_term),
                models.Запчасть.артикул.ilike(search_term)
            )
        )

    parts = query.offset(skip).limit(limit).all()

    result = []
    for part in parts:
        total_quantity = db.query(func.sum(models.ОстатокНаСкладе.количество)).filter(
            models.ОстатокНаСкладе.id_запчасти == part.id_запчасти
        ).scalar() or 0

        image_url = find_product_image(part.id_запчасти)
        if not image_url:
            print(f"⚠️ Изображение не найдено для товара {part.id_запчасти} в папке {PRODUCT_IMAGES_DIR}")

        part_dict = {
            **part.__dict__,
            "в_наличии": total_quantity > 0,
            "общее_количество": int(total_quantity),
            "image": image_url
        }
        part_obj = schemas.ЗапчастьСОстатком(**part_dict)
        print(f"📦 Товар {part.id_запчасти}: image = {part_obj.image}")
        result.append(part_obj)

    return result


@router.get("/{part_id}", response_model=schemas.ЗапчастьСОстатком)
def get_part(part_id: int, db: Session = Depends(get_db)):
    """Получить запчасть по ID"""
    part = db.query(models.Запчасть).filter(models.Запчасть.id_запчасти == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="Запчасть не найдена")

    total_quantity = db.query(func.sum(models.ОстатокНаСкладе.количество)).filter(
        models.ОстатокНаСкладе.id_запчасти == part_id
    ).scalar() or 0

    image_url = find_product_image(part_id)

    part_dict = {
        **part.__dict__,
        "в_наличии": total_quantity > 0,
        "общее_количество": int(total_quantity),
        "image": image_url
    }
    return schemas.ЗапчастьСОстатком(**part_dict)


@router.post("/", response_model=schemas.Запчасть)
def create_part(
    part: schemas.ЗапчастьCreate,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Создать новую запчасть"""
    db_part = models.Запчасть(**part.dict())
    db.add(db_part)
    db.flush()

    # Создаем остаток на складе по умолчанию
    default_warehouse = db.query(models.Склад).first()
    if default_warehouse:
        stock = models.ОстатокНаСкладе(
            id_запчасти=db_part.id_запчасти,
            id_склада=default_warehouse.id_склада,
            количество=0
        )
        db.add(stock)

    db.commit()
    db.refresh(db_part)
    return db_part


@router.post("/{part_id}/image")
async def upload_part_image(
        part_id: int,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Загрузить изображение для запчасти"""
    part = db.query(models.Запчасть).filter(models.Запчасть.id_запчасти == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="Запчасть не найдена")

    # Проверяем тип файла
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Файл должен быть изображением")

    # Определяем расширение файла из оригинального имени или content_type
    file_extension = "jpg"  # по умолчанию
    if file.filename:
        file_ext = file.filename.split('.')[-1].lower()
        if file_ext in IMAGE_EXTENSIONS:
            file_extension = file_ext
    elif file.content_type:
        # Определяем по content_type
        content_type_map = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp'
        }
        file_extension = content_type_map.get(file.content_type, 'jpg')

    # Удаляем старые изображения с разными расширениями
    for ext in IMAGE_EXTENSIONS:
        old_file = PRODUCT_IMAGES_DIR / f"{part_id}.{ext}"
        if old_file.exists():
            old_file.unlink()

    # Сохраняем файл
    file_path = PRODUCT_IMAGES_DIR / f"{part_id}.{file_extension}"

    try:
        print(f"📤 Загрузка изображения для товара {part_id}")
        print(f"   Расширение: {file_extension}")
        print(f"   Путь сохранения: {file_path}")
        print(f"   PRODUCT_IMAGES_DIR: {PRODUCT_IMAGES_DIR}")
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Проверяем, что файл действительно сохранен
        if not file_path.exists():
            raise HTTPException(status_code=500, detail="Файл не был сохранен")
        
        file_size = file_path.stat().st_size
        print(f"✅ Изображение сохранено: {file_path} (размер: {file_size} байт)")

        return {
            "message": "Изображение загружено",
            "path": f"/uploads/images/product/{part_id}.{file_extension}",
            "file_path": str(file_path),
            "upload_dir": str(PRODUCT_IMAGES_DIR)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка сохранения файла: {str(e)}")


@router.put("/{part_id}", response_model=schemas.Запчасть)
def update_part(
    part_id: int,
    part: schemas.ЗапчастьCreate,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Обновить запчасть"""
    db_part = db.query(models.Запчасть).filter(models.Запчасть.id_запчасти == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="Запчасть не найдена")

    for key, value in part.dict().items():
        setattr(db_part, key, value)

    db.commit()
    db.refresh(db_part)
    return db_part


@router.delete("/{part_id}")
def delete_part(
    part_id: int,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Удалить запчасть"""
    db_part = db.query(models.Запчасть).filter(models.Запчасть.id_запчасти == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="Запчасть не найдена")

    # Запоминаем файлы, но удаляем их только после успешного коммита БД.
    image_files_to_delete = []
    for ext in IMAGE_EXTENSIONS:
        image_path = PRODUCT_IMAGES_DIR / f"{part_id}.{ext}"
        if image_path.exists():
            image_files_to_delete.append(image_path)

    try:
        ensure_part_delete_does_not_break_orders(db)

        db.query(models.ОстатокНаСкладе).filter(
            models.ОстатокНаСкладе.id_запчасти == part_id
        ).delete(synchronize_session=False)
        db.query(models.Совместимость).filter(
            models.Совместимость.id_запчасти == part_id
        ).delete(synchronize_session=False)
        db.query(models.Запчасть).filter(
            models.Запчасть.id_запчасти == part_id
        ).delete(synchronize_session=False)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Не удалось удалить товар: {error.__class__.__name__}"
        )

    for image_path in image_files_to_delete:
        try:
            image_path.unlink(missing_ok=True)
        except OSError:
            print(f"⚠️ Не удалось удалить изображение товара: {image_path}")

    return {"message": "Запчасть удалена"}
