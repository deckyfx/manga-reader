# Dockerfile for manga-ocr
# Uses pre-built base image with manga-ocr and torch
FROM comic-reader-base:latest

# Set pip cache directory (for any additional packages)
ENV PIP_CACHE_DIR=/pip-cache

# Copy requirements file first (for additional dependencies if needed)
COPY requirements.txt .

# Install any additional dependencies (cache will be used if mounted)
RUN pip install --no-cache-dir -r requirements.txt

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create a simple test script
RUN echo 'from manga_ocr import MangaOcr\n\
import sys\n\
\n\
mocr = MangaOcr()\n\
print("manga-ocr initialized successfully!")\n\
print("Model loaded and ready to use")\n\
\n\
# If image path provided, run OCR\n\
if len(sys.argv) > 1:\n\
    result = mocr(sys.argv[1])\n\
    print(f"OCR Result: {result}")' > test_manga_ocr.py

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command: show that it works
CMD ["python", "test_manga_ocr.py"]
