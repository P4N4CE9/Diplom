from sqlalchemy import Column, Integer, String, Numeric, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class AppUser(Base):
    """Учётная запись: покупатель или администратор. Пароль только в виде bcrypt-хеша."""

    __tablename__ = "app_user"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Клиент(Base):
    __tablename__ = "клиент"

    id_клиента = Column(Integer, primary_key=True, index=True)
    фио = Column(String(255), nullable=False)
    телефон = Column(String(20))
    email = Column(String(100))
    адрес = Column(Text)
    дата_регистрации = Column(DateTime(timezone=True), server_default=func.now())

    заказы = relationship("Заказ", back_populates="клиент")


class Сотрудник(Base):
    __tablename__ = "сотрудник"

    id_сотрудника = Column(Integer, primary_key=True, index=True)
    фио = Column(String(255), nullable=False)
    должность = Column(String(100))
    телефон = Column(String(20))
    email = Column(String(100))
    дата_приема = Column(DateTime(timezone=True), server_default=func.now())

    заказы = relationship("Заказ", back_populates="сотрудник")


class Склад(Base):
    __tablename__ = "склад"

    id_склада = Column(Integer, primary_key=True, index=True)
    название_склада = Column(String(255), nullable=False)
    адрес = Column(Text)
    телефон = Column(String(20))
    заведующий = Column(String(255))

    остатки = relationship("ОстатокНаСкладе", back_populates="склад")


class Запчасть(Base):
    __tablename__ = "запчасть"

    id_запчасти = Column(Integer, primary_key=True, index=True)
    название = Column(String(255), nullable=False)
    артикул = Column(String(100), unique=True)
    категория = Column(String(100))
    состояние = Column(String(50))
    цена = Column(Numeric(10, 2))
    описание = Column(Text)

    остатки = relationship("ОстатокНаСкладе", back_populates="запчасть")
    позиции_заказа = relationship("ПозицияЗаказа", back_populates="запчасть")
    совместимости = relationship("Совместимость", back_populates="запчасть")


class ОстатокНаСкладе(Base):
    __tablename__ = "остаток_на_складе"

    id_остатка = Column(Integer, primary_key=True, index=True)
    id_запчасти = Column(Integer, ForeignKey("запчасть.id_запчасти", ondelete="CASCADE"), nullable=False)
    id_склада = Column(Integer, ForeignKey("склад.id_склада", ondelete="CASCADE"), nullable=False)
    количество = Column(Integer, default=0)
    код_места = Column(String(50))
    дата_обновления = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    запчасть = relationship("Запчасть", back_populates="остатки")
    склад = relationship("Склад", back_populates="остатки")


class Заказ(Base):
    __tablename__ = "заказ"

    id_заказа = Column(Integer, primary_key=True, index=True)
    id_клиента = Column(Integer, ForeignKey("клиент.id_клиента", ondelete="RESTRICT"), nullable=False)
    id_сотрудника = Column(Integer, ForeignKey("сотрудник.id_сотрудника", ondelete="SET NULL"))
    дата_заказа = Column(DateTime(timezone=True), server_default=func.now())
    общая_сумма = Column(Numeric(12, 2))
    статус = Column(String(50), default="новый")
    способ_оплаты = Column(String(50))

    клиент = relationship("Клиент", back_populates="заказы")
    сотрудник = relationship("Сотрудник", back_populates="заказы")
    позиции = relationship("ПозицияЗаказа", back_populates="заказ", cascade="all, delete-orphan")


class ПозицияЗаказа(Base):
    __tablename__ = "позиции_заказа"

    id = Column(Integer, primary_key=True, index=True)
    id_заказа = Column(Integer, ForeignKey("заказ.id_заказа", ondelete="CASCADE"), nullable=False)
    id_запчасти = Column(Integer, ForeignKey("запчасть.id_запчасти", ondelete="RESTRICT"), nullable=False)
    количество = Column(Integer, nullable=False)
    цена = Column(Numeric(10, 2), nullable=False)
    сумма = Column(Numeric(12, 2), nullable=False)

    заказ = relationship("Заказ", back_populates="позиции")
    запчасть = relationship("Запчасть", back_populates="позиции_заказа")


class МаркаАвто(Base):
    __tablename__ = "марка_авто"

    id_марки = Column(Integer, primary_key=True, index=True)
    название_марки = Column(String(100), nullable=False)
    страна_производитель = Column(String(100))

    модели = relationship("МодельАвто", back_populates="марка")


class МодельАвто(Base):
    __tablename__ = "модель_авто"

    id_модели = Column(Integer, primary_key=True, index=True)
    id_марки = Column(Integer, ForeignKey("марка_авто.id_марки", ondelete="CASCADE"), nullable=False)
    модель = Column(String(100), nullable=False)
    год_от = Column(Integer)
    год_до = Column(Integer)
    тип_кузова = Column(String(50))

    марка = relationship("МаркаАвто", back_populates="модели")
    совместимости = relationship("Совместимость", back_populates="модель")


class Совместимость(Base):
    __tablename__ = "совместимость"

    id_совместимости = Column(Integer, primary_key=True, index=True)
    id_запчасти = Column(Integer, ForeignKey("запчасть.id_запчасти", ondelete="CASCADE"), nullable=False)
    id_модели = Column(Integer, ForeignKey("модель_авто.id_модели", ondelete="CASCADE"), nullable=False)
    примечание = Column(Text)

    запчасть = relationship("Запчасть", back_populates="совместимости")
    модель = relationship("МодельАвто", back_populates="совместимости")