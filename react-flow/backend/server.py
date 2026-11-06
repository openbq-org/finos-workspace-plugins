from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

import flows

ORIGINS = ["http://localhost:3000", "http://localhost:1420"]


async def widgets(_request: Request) -> JSONResponse:
    return JSONResponse(flows.WIDGETS)


def diagram(name: str):
    async def handler(_request: Request) -> JSONResponse:
        return JSONResponse(flows.FLOWS[name])

    return handler


app = Starlette(
    routes=[
        Route("/widgets.json", widgets),
        *[Route(f"/{name}", diagram(name)) for name in flows.FLOWS],
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])],
)
