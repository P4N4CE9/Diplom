"""
Полная подготовка проекта к запуску (фронт + зависимости бэкенда).
Запуск из корня auto-parts-shop: python build.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def run(cmd: list[str], cwd: Path) -> None:
    print(">", " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd), check=True)


def resolve_python() -> str:
    venv_python = ROOT.parent / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


def main() -> None:
    python = resolve_python()
    run([python, "build_frontend.py"], FRONTEND)

    req = BACKEND / "requirements.txt"
    if req.exists():
        run([python, "-m", "pip", "install", "-r", str(req)], BACKEND)

    print("\n[OK] Готово. Запуск: cd backend && python run.py")
    print("    (фронт: Vite CSS + app.bundle.js; нужен Node.js: npm install в frontend/)")


if __name__ == "__main__":
    main()
