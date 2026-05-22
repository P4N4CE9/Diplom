import sys
import webbrowser
import threading
import time
import os
from pathlib import Path

try:
    import uvicorn
except ImportError:
    venv_python = Path(__file__).resolve().parents[2] / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        print(f"Перезапуск через виртуальное окружение: {venv_python}")
        os.execv(str(venv_python), [str(venv_python), *sys.argv])
    print("Установите зависимости: pip install -r requirements.txt")
    print("Или из папки auto-parts-shop: python build.py")
    sys.exit(1)


def open_browser():
    """Открывает браузер после небольшой задержки"""
    time.sleep(2)  # Ждем пока сервер запустится
    webbrowser.open("http://localhost:8000/")


if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()

    # Запускаем сервер
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False
    )
