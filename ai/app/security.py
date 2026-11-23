from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import settings


async def require_service_secret(
    x_ai_service_secret: Optional[str] = Header(default=None, alias="X-AI-Service-Secret"),
) -> None:
    if not x_ai_service_secret or x_ai_service_secret != settings.service_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid AI service secret",
        )
