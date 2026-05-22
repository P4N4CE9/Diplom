from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=schemas.UserPublic)
def register(payload: schemas.UserRegister, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.query(models.AppUser).filter(models.AppUser.email == email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email уже зарегистрирован")

    user = models.AppUser(
        email=email,
        hashed_password=auth.get_password_hash(payload.password),
        full_name=(payload.full_name or "").strip() or None,
        is_admin=False,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=schemas.TokenWithUser)
def login_json(payload: schemas.UserLogin, db: Session = Depends(get_db)):
    user = auth.authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    token = auth.user_to_token(user)
    return schemas.TokenWithUser(
        access_token=token,
        user=schemas.UserPublic.model_validate(user),
    )


@router.get("/me", response_model=schemas.UserPublic)
def me(current: models.AppUser = Depends(auth.get_current_user)):
    return current
