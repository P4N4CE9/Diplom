from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func
from typing import List
from datetime import datetime
from decimal import Decimal
from app.database import get_db
from app import models, schemas, auth, onec_integration

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.post("/", response_model=schemas.Заказ)
def create_order(
    response: Response,
    order: schemas.ЗаказCreate,
    db: Session = Depends(get_db),
):
    """Создать новый заказ"""
    # Проверка существования клиента
    client = db.query(models.Клиент).filter(models.Клиент.id_клиента == order.id_клиента).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    # Проверка наличия товаров и расчет суммы
    total_sum = Decimal(0)
    for position in order.позиции:
        part = db.query(models.Запчасть).filter(models.Запчасть.id_запчасти == position.id_запчасти).first()
        if not part:
            raise HTTPException(status_code=404, detail=f"Запчасть {position.id_запчасти} не найдена")

        # Проверка остатков
        total_stock = db.query(func.sum(models.ОстатокНаСкладе.количество)).filter(
            models.ОстатокНаСкладе.id_запчасти == position.id_запчасти
        ).scalar() or 0

        if total_stock < position.количество:
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно товара для запчасти {part.название}. Доступно: {total_stock}"
            )

        position.сумма = position.цена * position.количество
        total_sum += position.сумма

    # Создание заказа
    db_order = models.Заказ(
        id_клиента=order.id_клиента,
        общая_сумма=total_sum,
        статус="новый",
        способ_оплаты=order.способ_оплаты
    )
    db.add(db_order)
    db.flush()

    # Создание позиций заказа
    for position in order.позиции:
        db_position = models.ПозицияЗаказа(
            id_заказа=db_order.id_заказа,
            **position.dict()
        )
        db.add(db_position)

        # Уменьшение остатков (берем с первого склада, где есть товар)
        stock = db.query(models.ОстатокНаСкладе).filter(
            models.ОстатокНаСкладе.id_запчасти == position.id_запчасти,
            models.ОстатокНаСкладе.количество > 0
        ).first()

        if stock:
            stock.количество -= position.количество
            if stock.количество < 0:
                stock.количество = 0

    db.commit()
    db.refresh(db_order)
    onec = onec_integration.notify_onec_order_created(db, db_order.id_заказа)
    response.headers["X-OneC-Export-Status"] = onec.export_status
    if onec.export_path:
        response.headers["X-OneC-Export-Path"] = onec.export_path
    if onec.webhook_attempted:
        response.headers["X-OneC-Webhook"] = "ok" if onec.webhook_ok else "failed"
    return db_order


@router.get("/", response_model=List[schemas.Заказ])
def get_orders(
        skip: int = 0,
        limit: int = 100,
        status: str = None,
        db: Session = Depends(get_db),
        _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Получить список заказов"""
    query = db.query(models.Заказ)

    if status:
        query = query.filter(models.Заказ.статус == status)

    orders = query.order_by(models.Заказ.дата_заказа.desc()).offset(skip).limit(limit).all()
    return orders


@router.get("/my", response_model=List[schemas.UserOrderHistory])
def get_my_orders(
    db: Session = Depends(get_db),
    current_user: models.AppUser = Depends(auth.get_current_user),
):
    """Получить историю заказов текущего пользователя по email аккаунта."""
    user_email = (current_user.email or "").strip().lower()
    if not user_email:
        return []

    orders = (
        db.query(models.Заказ)
        .join(models.Клиент, models.Клиент.id_клиента == models.Заказ.id_клиента)
        .filter(func.lower(models.Клиент.email) == user_email)
        .options(
            selectinload(models.Заказ.позиции).selectinload(models.ПозицияЗаказа.запчасть)
        )
        .order_by(models.Заказ.дата_заказа.desc())
        .all()
    )

    return [
        {
            "id_заказа": order.id_заказа,
            "дата_заказа": order.дата_заказа,
            "общая_сумма": order.общая_сумма,
            "статус": order.статус,
            "способ_оплаты": order.способ_оплаты,
            "позиции": [
                {
                    "id": position.id,
                    "id_запчасти": position.id_запчасти,
                    "название": position.запчасть.название if position.запчасть else f"Товар #{position.id_запчасти}",
                    "артикул": position.запчасть.артикул if position.запчасть else None,
                    "количество": position.количество,
                    "цена": position.цена,
                    "сумма": position.сумма,
                }
                for position in order.позиции
            ],
        }
        for order in orders
    ]


@router.get("/{order_id}", response_model=schemas.Заказ)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Получить заказ по ID"""
    order = db.query(models.Заказ).filter(models.Заказ.id_заказа == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return order


@router.patch("/{order_id}/status")
def update_order_status(
    order_id: int,
    new_status: str,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Обновить статус заказа"""
    order = db.query(models.Заказ).filter(models.Заказ.id_заказа == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    order.статус = new_status
    db.commit()
    return {"message": "Статус обновлен", "order": order}


@router.delete("/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: models.AppUser = Depends(auth.get_current_admin_user),
):
    """Удалить заказ"""
    order = db.query(models.Заказ).filter(models.Заказ.id_заказа == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    # Возвращаем товары на склад (увеличиваем остатки)
    for position in order.позиции:
        # Ищем остаток для этой запчасти (берем первый доступный склад)
        stock = db.query(models.ОстатокНаСкладе).filter(
            models.ОстатокНаСкладе.id_запчасти == position.id_запчасти
        ).first()
        
        if stock:
            stock.количество += position.количество
        else:
            # Если остатка нет, создаем новый на первом складе
            first_warehouse = db.query(models.Склад).first()
            if first_warehouse:
                new_stock = models.ОстатокНаСкладе(
                    id_запчасти=position.id_запчасти,
                    id_склада=first_warehouse.id_склада,
                    количество=position.количество
                )
                db.add(new_stock)

    # Удаляем заказ (позиции удалятся автоматически благодаря cascade)
    db.delete(order)
    db.commit()
    return {"message": "Заказ удален"}
