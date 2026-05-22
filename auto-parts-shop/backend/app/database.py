from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# .env из каталога backend/ — не зависит от текущей рабочей папки (PyCharm, uvicorn из корня репо)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_ROOT / ".env")
load_dotenv()  # при необходимости переопределение из cwd

# Получаем URL из переменных окружения или используем дефолтный
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://test:test@localhost:5432/Diplom"
)

# Создаем движок SQLAlchemy
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Проверяет соединение перед использованием
    echo=False  # Установите True для отладки SQL запросов
)

# Создаем фабрику сессий
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Базовый класс для моделей
Base = declarative_base()

def get_db():
    """
    Генератор для получения сессии БД.


    Используется как зависимость в FastAPI.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()