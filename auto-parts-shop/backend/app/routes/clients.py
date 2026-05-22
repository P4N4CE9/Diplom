from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models, schemas, auth

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.post("/", response_model=schemas.Клиент)
def create_client(client: schemas.КлиентCreate, db: Session = Depends(get_db)):
    """Создать нового клиента"""
    db_client = models.Клиент(**client.dict())
    db.add(db_client)
    db.commit()
    db.refresh(db_client)
    return db_client


@router.post("/for-checkout", response_model=schemas.Клиент)
def get_or_create_for_checkout(client: schemas.КлиентCreate, db: Session = Depends(get_db)):
    """Для оформления заказа без авторизации: найти клиента по email или создать."""
    if client.email:
        existing = db.query(models.Клиент).filter(models.Клиент.email == client.email).first()
        if existing:
            return existing
    db_client = models.Клиент(**client.dict())
    db.add(db_client)
    db.commit()
    db.refresh(db_client)
    return db_client


@router.get("/", response_model=List[schemas.Клиент])
def get_clients(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Получить список клиентов"""
    clients = db.query(models.Клиент).offset(skip).limit(limit).all()
    return clients


@router.get("/{client_id}", response_model=schemas.Клиент)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Получить клиента по ID"""
    client = db.query(models.Клиент).filter(models.Клиент.id_клиента == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    return client


@router.put("/{client_id}", response_model=schemas.Клиент)
def update_client(
    client_id: int,
    client: schemas.КлиентCreate,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Обновить данные клиента"""
    db_client = db.query(models.Клиент).filter(models.Клиент.id_клиента == client_id).first()
    if not db_client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    for key, value in client.dict().items():
        setattr(db_client, key, value)

    db.commit()
    db.refresh(db_client)
    return db_client


@router.get("/warehouses/")
def get_warehouses(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Получить список складов"""
    warehouses = db.query(models.Склад).offset(skip).limit(limit).all()
    return warehouses