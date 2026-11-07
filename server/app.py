"""Tiny audio proxy for a personal EQ player.

Resolves YouTube audio with yt-dlp and streams it through this server so the
mobile app can download and decode it (EQ is applied on the phone).

Run:  EQ_TOKEN=some-long-secret uvicorn app:app --host 0.0.0.0 --port 8000
"""
import json
import os
import re
import subprocess
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

TOKEN = os.environ.get("EQ_TOKEN", "")
URL_TTL = 300  # seconds a resolved direct URL stays cached
ID_RE = re.compile(r"^[\w-]{11}$")

app = FastAPI()
_cache: dict[str, tuple[float, str]] = {}


def check_key(key: str) -> None:
    # Deny everything when no token is configured (safe default).
    if not TOKEN or key != TOKEN:
        raise HTTPException(401, "bad key")


def run_ytdlp(args: list[str]) -> str:
    proc = subprocess.run(
        ["yt-dlp", *args], capture_output=True, text=True, timeout=45
    )
    if proc.returncode != 0:
        raise HTTPException(502, proc.stderr.strip()[-300:])
    return proc.stdout


def resolve(video_id: str) -> str:
    """Return a direct audio URL for the video (cached briefly)."""
    now = time.time()
    hit = _cache.get(video_id)
    if hit and hit[0] > now:
        return hit[1]
    # Prefer m4a (AAC): iOS Safari plays it reliably, unlike webm/opus.
    out = run_ytdlp(
        [
            "-f", "bestaudio[ext=m4a]/bestaudio",
            "-g", "--no-playlist",
            f"https://www.youtube.com/watch?v={video_id}",
        ]
    )
    url = out.strip().splitlines()[0]
    _cache[video_id] = (now + URL_TTL, url)
    return url


@app.get("/api/search")
def search(q: str, key: str = ""):
    check_key(key)
    out = run_ytdlp(["--flat-playlist", "-J", f"ytsearch10:{q}"])
    entries = json.loads(out).get("entries", [])
    return [
        {
            "id": e["id"],
            "title": e.get("title"),
            "channel": e.get("uploader") or e.get("channel"),
            "duration": e.get("duration"),
        }
        for e in entries
        if e.get("id") and ID_RE.match(e["id"])
    ]


@app.get("/api/stream/{video_id}")
async def stream(video_id: str, request: Request, key: str = ""):
    check_key(key)
    if not ID_RE.match(video_id):
        raise HTTPException(400, "bad id")
    url = await run_in_threadpool(resolve, video_id)

    # Forward Range so seeking works (Safari requires range support).
    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]

    client = httpx.AsyncClient(timeout=None)
    upstream = await client.send(
        client.build_request("GET", url, headers=headers), stream=True
    )
    keep = {"content-type", "content-length", "content-range", "accept-ranges"}
    out_headers = {k: v for k, v in upstream.headers.items() if k.lower() in keep}

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(), status_code=upstream.status_code, headers=out_headers
    )
