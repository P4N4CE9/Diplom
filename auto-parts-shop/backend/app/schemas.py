from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime
from decimal import Decimal
from typing import Optional, List


def _normalize_app_email(v: str) -> str:
    """Email для входа/регистрации: без строгого EmailStr (разрешены .local, intranet и т.д.)."""
    if not isinstance(v, str):
        raise ValueError("Email должен быть строкой")
    s = v.strip().lower()
    if not s or "@" not in s:
        raise ValueError("Укажите email")
    local, _, domain = s.partition("@")
    if not local or not domain:
        raise ValueError("Укажите email вида user@domain")
    if "@" in domain:
        raise ValueError("Некорректный email")
    return s


# Клиент
class КлиентBase(BaseModel):
    фио: str
    телефон: Optional[str] = None
    email: Optional[EmailStr] = None
    адрес: Optional[str] = None


class КлиентCreate(КлиентBase):
    pass


class Клиент(КлиентBase):
    id_клиента: int
    дата_регистрации: datetime

    class Config:
        from_attributes = True


# Запчасть
class ЗапчастьBase(BaseModel):
    название: str
    артикул: Optional[str] = None
    категория: Optional[str] = None
    состояние: Optional[str] = None
    цена: Optional[Decimal] = None
    описание: Optional[str] = None


class ЗапчастьCreate(ЗапчастьBase):
    pass


class Запчасть(ЗапчастьBase):
    id_запчасти: int

    class Config:
        from_attributes = True


class ЗапчастьСОстатком(Запчасть):
    в_наличии: bool
    общее_количество: int
    image: Optional[str] = None

    class Config:
        from_attributes = True


# Позиция заказа
class ПозицияЗаказаBase(BaseModel):
    id_запчасти: int
    количество: int
    цена: Decimal
    сумма: Decimal


class ПозицияЗаказаCreate(ПозицияЗаказаBase):
    pass


class ПозицияЗаказа(ПозицияЗаказаBase):
    id: int
    id_заказа: int

    class Config:
        from_attributes = True


# Заказ
class ЗаказBase(BaseModel):
    способ_оплаты: Optional[str] = None


class ЗаказCreate(ЗаказBase):
    id_клиента: int
    позиции: List[ПозицияЗаказаCreate]


class Заказ(ЗаказBase):
    id_заказа: int
    id_клиента: int
    id_сотрудника: Optional[int] = None
    дата_заказа: datetime
    общая_сумма: Optional[Decimal] = None
    статус: str
    позиции: List[ПозицияЗаказа] = []

    class Config:
        from_attributes = True


class UserOrderHistoryItem(BaseModel):
    id: int
    id_запчасти: int
    название: str
    артикул: Optional[str] = None
    количество: int
    цена: Decimal
    сумма: Decimal


class UserOrderHistory(BaseModel):
    id_заказа: int
    дата_заказа: datetime
    общая_сумма: Optional[Decimal] = None
    статус: str
    способ_оплаты: Optional[str] = None
    позиции: List[UserOrderHistoryItem] = []


# Сотрудник
class СотрудникBase(BaseModel):
    фио: str
    должность: Optional[str] = None
    телефон: Optional[str] = None
    email: Optional[EmailStr] = None


class СотрудникCreate(СотрудникBase):
    pass


class Сотрудник(СотрудникBase):
    id_сотрудника: int
    дата_приема: datetime

    class Config:
        from_attributes = True


# Склад
class СкладBase(BaseModel):
    название_склада: str
    адрес: Optional[str] = None
    телефон: Optional[str] = None
    заведующий: Optional[str] = None


class СкладCreate(СкладBase):
    pass


class Склад(СкладBase):
    id_склада: int

    class Config:
        from_attributes = True


# Остаток на складе
class ОстатокНаСкладеBase(BaseModel):
    id_запчасти: int
    id_склада: int
    количество: int = 0
    код_места: Optional[str] = None


class ОстатокНаСкладеCreate(ОстатокНаСкладеBase):
    pass


class ОстатокНаСкладе(ОстатокНаСкладеBase):
    id_остатка: int
    дата_обновления: datetime

    class Config:
        from_attributes = True


# Марка авто
class МаркаАвтоBase(BaseModel):
    название_марки: str
    страна_производитель: Optional[str] = None


class МаркаАвтоCreate(МаркаАвтоBase):
    pass


class МаркаАвто(МаркаАвтоBase):
    id_марки: int

    class Config:
        from_attributes = True


# Модель авто
class МодельАвтоBase(BaseModel):
    id_марки: int
    модель: str
    год_от: Optional[int] = None
    год_до: Optional[int] = None
    тип_кузова: Optional[str] = None


class МодельАвтоCreate(МодельАвтоBase):
    pass


class МодельАвто(МодельАвтоBase):
    id_модели: int

    class Config:
        from_attributes = True


# Совместимость
class СовместимостьBase(BaseModel):
    id_запчасти: int
    id_модели: int
    примечание: Optional[str] = None


class СовместимостьCreate(СовместимостьBase):
    pass


class Совместимость(СовместимостьBase):
    id_совместимости: int

    class Config:
        from_attributes = True


# Пользователи сайта (регистрация / вход)
class UserRegister(BaseModel):
    email: str
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=255)

    @field_validator("email")
    @classmethod
    def email_normalized(cls, v: str) -> str:
        return _normalize_app_email(v)


class UserLogin(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_normalized(cls, v: str) -> str:
        return _normalize_app_email(v)


class UserPublic(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    is_admin: bool

    class Config:
        from_attributes = True


class TokenWithUser(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
