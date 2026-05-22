"""
Отправка созданного заказа в 1С через HTTP (вебхук).

1С должна опубликовать HTTP-сервис, принимающий JSON (см. файл onec/ShopOrderWebhook.bsl.txt).
Путь к файловой базе (например C:\\Users\\User\\Documents\\InfoBase19) задаётся в конфигураторе
при публикации веб-сервера — не в этом модуле.

Переменные окружения:
  ONEC_ORDER_WEBHOOK_URL — полный URL метода приёма заказа (если пусто — HTTP не вызывается).
  ONEC_WEBHOOK_SECRET     — необязательно: заголовок Authorization: Bearer <secret>.
  ONEC_HTTP_TIMEOUT       — таймаут секунд (по умолчанию 15).
  ONEC_ORDER_EXPORT_DIR   — если задано, в эту папку дополнительно пишется order_<id>.json
                            (обход без HTTP-сервиса: 1С читает файлы обработкой/регламентом).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

import httpx
from sqlalchemy.orm import Session, joinedload

from app import models

logger = logging.getLogger(__name__)


@dataclass
class OnecNotifyResult:
    """Результат попытки передать заказ в 1С (для заголовков ответа API / демонстрации)."""

    export_path: Optional[str] = None
    export_status: Literal["ok", "skipped", "failed"] = "skipped"
    webhook_attempted: bool = False
    webhook_ok: bool = False


def _dec(v: Any) -> Optional[str]:
    if v is None:
        return None
    return str(v)


def build_order_payload(order: models.Заказ) -> Dict[str, Any]:
    client = order.клиент
    lines = []
    for p in order.позиции:
        part = p.запчасть
        lines.append(
            {
                "id_запчасти": p.id_запчасти,
                "артикул": part.артикул if part else None,
                "название": part.название if part else None,
                "количество": p.количество,
                "цена": _dec(p.цена),
                "сумма": _dec(p.сумма),
            }
        )
    return {
        "id_заказа": order.id_заказа,
        "дата_заказа": order.дата_заказа.isoformat() if order.дата_заказа else None,
        "статус": order.статус,
        "способ_оплаты": order.способ_оплаты,
        "общая_сумма": _dec(order.общая_сумма),
        "клиент": {
            "id_клиента": client.id_клиента if client else None,
            "фио": client.фио if client else None,
            "email": client.email if client else None,
            "телефон": client.телефон if client else None,
            "адрес": client.адрес if client else None,
        },
        "позиции": lines,
    }


def send_order_to_onec(payload: Dict[str, Any]) -> bool:
    url = os.getenv("ONEC_ORDER_WEBHOOK_URL", "").strip()
    if not url:
        return False
    secret = os.getenv("ONEC_WEBHOOK_SECRET", "").strip()
    headers: Dict[str, str] = {"Content-Type": "application/json; charset=utf-8"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    timeout = float(os.getenv("ONEC_HTTP_TIMEOUT", "15"))
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=payload, headers=headers)
            r.raise_for_status()
        logger.info("1C: заказ %s отправлен", payload.get("id_заказа"))
        return True
    except Exception:
        logger.exception("1C: не удалось отправить заказ %s", payload.get("id_заказа"))
        return False


def export_order_json_to_dir(payload: Dict[str, Any]) -> tuple[Literal["ok", "skipped", "failed"], Optional[str]]:
    """Сохранить заказ в JSON-файл (атомарная запись через .tmp). Возвращает (статус, полный путь)."""
    directory = os.getenv("ONEC_ORDER_EXPORT_DIR", "").strip()
    if not directory:
        return "skipped", None
    try:
        os.makedirs(directory, exist_ok=True)
        oid = payload.get("id_заказа")
        path = os.path.join(directory, f"order_{oid}.json")
        tmp = path + ".tmp"
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, path)
        logger.info("1C: заказ %s записан в %s", oid, path)
        return "ok", path
    except Exception:
        logger.exception("1C: не удалось записать JSON заказа %s", payload.get("id_заказа"))
        return "failed", None


def notify_onec_order_created(db: Session, order_id: int) -> OnecNotifyResult:
    """Загружает заказ с клиентом и номенклатурой: JSON в папку (для 1С) и при необходимости HTTP POST."""
    result = OnecNotifyResult()
    order = (
        db.query(models.Заказ)
        .options(
            joinedload(models.Заказ.клиент),
            joinedload(models.Заказ.позиции).joinedload(models.ПозицияЗаказа.запчасть),
        )
        .filter(models.Заказ.id_заказа == order_id)
        .first()
    )
    if not order:
        return result
    payload = build_order_payload(order)
    status, path = export_order_json_to_dir(payload)
    result.export_status = status
    result.export_path = path
    if os.getenv("ONEC_ORDER_WEBHOOK_URL", "").strip():
        result.webhook_attempted = True
        result.webhook_ok = send_order_to_onec(payload)
    return result
