"""FastAPI app: routers, CORS, startup tasks, and (optionally) the built web app."""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import db
from app.config import settings
from app.orders.queue import expiry_loop
from app.routers import buyer, catalog, payments, public, seller, sessions
from app.seed import seed_if_empty

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.create_all()
    if settings.seed_demo:
        await seed_if_empty()
    loop = asyncio.create_task(expiry_loop())
    yield
    loop.cancel()
    from app.sources import runner
    for sid in list(runner.RUNNING):
        runner.stop(sid)
    await db.engine.dispose()


app = FastAPI(title="mineIt! API", version="1.0.0", lifespan=lifespan)
origins = [o.strip() for o in settings.web_origin.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

api = FastAPI(title="mineIt! API", version="1.0.0",
              description="Seller routes need the X-Seller-Key header. Buyer routes need only the order token.")
for r in (sessions, catalog, buyer, payments, public, seller):
    api.include_router(r.router)


@api.get("/health")
async def health():
    return {"ok": True}


app.mount("/api", api)


@app.get("/health")
async def root_health():
    return {"ok": True}


if settings.serve_web and WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = (WEB_DIST / path).resolve()
        if path and f.is_file() and WEB_DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(WEB_DIST / "index.html")   # client-side routes like /o/:token
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return JSONResponse({"ok": True, "docs": "/api/docs",
                             "web": "run `npm run dev` in web/ or `npm run build` to serve it here"})
