FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LINGO_CLOUD_REQUIRE_CREDENTIALS=1
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
CMD ["sh", "-c", "exec uvicorn app.cloud_gateway:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log --proxy-headers"]
