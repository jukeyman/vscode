# Dockerfile for Orchestrator Core Service

FROM python:3.9-slim
WORKDIR /app
COPY . /app/
# RUN pip install --no-cache-dir -r requirements.txt # Placeholder
EXPOSE 8000
# Actual CMD for FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
