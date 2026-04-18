from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


def _get_async_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if "asyncpg" in url and "sslmode" not in url:
        separator = "&" if "?" in url else "?"
        url += f"{separator}ssl=require"
    return url


_async_url = _get_async_url(settings.database_url)
_connect_args = {"ssl": "require"} if "asyncpg" in _async_url else {}
engine = create_async_engine(_async_url, echo=settings.debug, connect_args=_connect_args)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
