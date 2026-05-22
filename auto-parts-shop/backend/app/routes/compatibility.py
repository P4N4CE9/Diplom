from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/compatibility", tags=["compatibility"])


@router.get("/parts/{part_id}/models", response_model=List[schemas.МодельАвто])
def get_compatible_models(part_id: int, db: Session = Depends(get_db)):
    """Получить список совместимых моделей для запчасти"""
    compatibilities = db.query(models.Совместимость).filter(
        models.Совместимость.id_запчасти == part_id
    ).all()

    models_list = [comp.модель for comp in compatibilities]
    return models_list


@router.get("/models/{model_id}/parts", response_model=List[schemas.Запчасть])
def get_compatible_parts(model_id: int, db: Session = Depends(get_db)):
    """Получить список совместимых запчастей для модели"""
    compatibilities = db.query(models.Совместимость).filter(
        models.Совместимость.id_модели == model_id
    ).all()

    parts_list = [comp.запчасть for comp in compatibilities]
    return parts_list


@router.post("/", response_model=schemas.Совместимость)
def create_compatibility(compat: schemas.СовместимостьCreate, db: Session = Depends(get_db)):
    """Добавить совместимость"""
    db_compat = models.Совместимость(**compat.dict())
    db.add(db_compat)
    db.commit()
    db.refresh(db_compat)
    return db_compat