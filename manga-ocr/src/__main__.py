"""
Entry point for manga-ocr server

Usage:
    python -m src
"""

from .server import start_server

if __name__ == "__main__":
    start_server(socket_path="/app/sock/manga-ocr.sock")
