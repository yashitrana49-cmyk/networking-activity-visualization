from threading import Lock


_browser_events = []

_browser_lock = Lock()

MAX_BROWSER_EVENTS = 10000


def add_browser_event(event):
    """
    Store browser activity.
    """

    with _browser_lock:

        _browser_events.append(event)

        if len(_browser_events) > MAX_BROWSER_EVENTS:

            del _browser_events[
                :-MAX_BROWSER_EVENTS
            ]


def get_browser_events():

    with _browser_lock:

        return list(_browser_events)

def clear_browser_events():
    with _browser_lock:
        _browser_events.clear()