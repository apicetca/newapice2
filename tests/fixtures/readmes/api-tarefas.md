# API de Tarefas

API REST em Python com FastAPI. Os dados ficam num banco MySQL;
cada endpoint monta a query com SQLAlchemy.

## Rodando

    pip install -r requirements.txt
    uvicorn app.main:app --reload

Também dá para subir com Docker (veja o Dockerfile).
