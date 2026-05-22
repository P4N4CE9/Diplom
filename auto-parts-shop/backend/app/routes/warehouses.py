from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models, schemas
from typing import List

router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])

@router.get("/", response_model=List[schemas.Склад])
def get_warehouses(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Получить список складов"""
    warehouses = db.query(models.Склад).offset(skip).limit(limit).all()
    return warehouses