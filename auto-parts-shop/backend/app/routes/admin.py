from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.database import get_db
from app import auth, schemas
from app.models import ОстатокНаСкладе, Запчасть, Склад
from typing import List, Optional
from sqlalchemy import func
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


# Модель для создания остатка
class StockCreate(BaseModel):
    id_запчасти: int
    id_склада: int
    количество: int = 0
    код_места: Optional[str] = None


@router.post("/token")
async def login_oauth(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2: в поле username укажите email. Токен выдаётся любому активному пользователю (не только админу)."""
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.user_to_token(user)
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/warehouses")
def get_warehouses(
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Получить список складов"""
    warehouses = db.query(Склад).all()
    return [{
        "id_склада": w.id_склада,
        "название_склада": w.название_склада,
        "адрес": w.адрес,
        "телефон": w.телефон
    } for w in warehouses]


@router.get("/stock/low")
def get_low_stock_items(
        threshold: int = Query(5, ge=0),
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Получить товары с низким остатком"""
    low_stock = db.query(ОстатокНаСкладе).filter(
        ОстатокНаСкладе.количество <= threshold
    ).all()

    result = []
    for stock in low_stock:
        part = db.query(Запчасть).filter(Запчасть.id_запчасти == stock.id_запчасти).first()
        warehouse = db.query(Склад).filter(Склад.id_склада == stock.id_склада).first()

        if part:
            result.append({
                "id_остатка": stock.id_остатка,
                "id_запчасти": stock.id_запчасти,
                "запчасть": part.название,
                "артикул": part.артикул,
                "склад": warehouse.название_склада if warehouse else "Неизвестно",
                "id_склада": stock.id_склада,
                "количество": stock.количество,
                "код_места": stock.код_места
            })

    return result


@router.get("/stock/all")
def get_all_stock(
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Получить все остатки на складах"""
    stocks = db.query(ОстатокНаСкладе).all()

    result = []
    for stock in stocks:
        part = db.query(Запчасть).filter(Запчасть.id_запчасти == stock.id_запчасти).first()
        warehouse = db.query(Склад).filter(Склад.id_склада == stock.id_склада).first()

        if part:
            result.append({
                "id_остатка": stock.id_остатка,
                "id_запчасти": stock.id_запчасти,
                "запчасть": part.название,
                "артикул": part.артикул,
                "склад": warehouse.название_склада if warehouse else "Неизвестно",
                "id_склада": stock.id_склада,
                "количество": stock.количество,
                "код_места": stock.код_места
            })

    return result


@router.put("/stock/{stock_id}")
def update_stock(
        stock_id: int,
        quantity: int = Query(..., ge=0),
        код_места: Optional[str] = Query(None),
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Обновить остаток на складе"""
    stock = db.query(ОстатокНаСкладе).filter(ОстатокНаСкладе.id_остатка == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Остаток не найден")

    stock.количество = quantity
    if код_места is not None:
        stock.код_места = код_места
    db.commit()
    db.refresh(stock)

    return {
        "message": "Остаток обновлен",
        "stock": {
            "id_остатка": stock.id_остатка,
            "количество": stock.количество,
            "код_места": stock.код_места
        }
    }


@router.post("/stock")
def create_stock(
        stock_data: StockCreate = Body(...),
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Создать остаток на складе"""
    # Проверяем существование запчасти и склада
    part = db.query(Запчасть).filter(Запчасть.id_запчасти == stock_data.id_запчасти).first()
    if not part:
        raise HTTPException(status_code=404, detail="Запчасть не найдена")

    warehouse = db.query(Склад).filter(Склад.id_склада == stock_data.id_склада).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Склад не найден")

    # Проверяем, не существует ли уже остаток
    existing = db.query(ОстатокНаСкладе).filter(
        ОстатокНаСкладе.id_запчасти == stock_data.id_запчасти,
        ОстатокНаСкладе.id_склада == stock_data.id_склада
    ).first()

    if existing:
        existing.количество = stock_data.количество
        if stock_data.код_места:
            existing.код_места = stock_data.код_места
        db.commit()
        db.refresh(existing)
        return {
            "message": "Остаток обновлен",
            "stock": {
                "id_остатка": existing.id_остатка,
                "количество": existing.количество
            }
        }

    stock = ОстатокНаСкладе(
        id_запчасти=stock_data.id_запчасти,
        id_склада=stock_data.id_склада,
        количество=stock_data.количество,
        код_места=stock_data.код_места
    )
    db.add(stock)
    db.commit()
    db.refresh(stock)

    return {
        "message": "Остаток создан",
        "stock": {
            "id_остатка": stock.id_остатка,
            "количество": stock.количество
        }
    }


@router.delete("/stock/{stock_id}")
def delete_stock(
        stock_id: int,
        db: Session = Depends(get_db),
        current_user=Depends(auth.get_current_admin_user),
):
    """Удалить остаток"""
    stock = db.query(ОстатокНаСкладе).filter(ОстатокНаСкладе.id_остатка == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Остаток не найден")

    db.delete(stock)
    db.commit()
    return {"message": "Остаток удален"}