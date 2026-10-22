"""WebRTC signaling for the in-app live video (seller camera -> viewer phones).

The video itself never touches the backend: it flows peer-to-peer from the seller's
browser to each viewer. The backend only passes the SDP offer/answer between them
(non-trickle ICE, so one round trip is enough):

  viewer  --POST offer-->  backend  --SSE "rtc-offer"-->  seller board
  seller  --POST answer--> backend  <--GET answer (poll)--  viewer
"""
import time

_state: dict[str, dict] = {}          # session_id -> {"live": bool, "since": float}
_answers: dict[str, tuple[float, str]] = {}  # peer_id -> (time, answer sdp)


def rtc_state(session_id: str) -> dict:
    return _state.get(session_id, {"live": False, "since": None})


def set_live(session_id: str, live: bool):
    _state[session_id] = {"live": live, "since": time.time() if live else None}


def put_answer(peer_id: str, sdp: str):
    now = time.time()
    for k, (t, _) in list(_answers.items()):      # drop stale answers
        if now - t > 120:
            _answers.pop(k, None)
    _answers[peer_id] = (now, sdp)


def take_answer(peer_id: str) -> str | None:
    item = _answers.pop(peer_id, None)
    return item[1] if item else None
