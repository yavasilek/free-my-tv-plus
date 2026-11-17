"""Expose selected climate readings to a Free My TV on the local network."""

import math
import re

from aiohttp import web
import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.helpers import config_validation as cv

DOMAIN = "fmtv_home"
ROOM = vol.Schema({
    vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=24)),
    vol.Required("temperature"): cv.entity_id,
    vol.Optional("humidity"): cv.entity_id,
})
CONFIG_SCHEMA = vol.Schema({
    DOMAIN: {
        vol.Required("webhook_id"): vol.All(cv.string, vol.Match(r"^[a-zA-Z0-9_-]{32,128}$")),
        vol.Required("weather"): cv.entity_id,
        vol.Optional("rooms", default=[]): vol.All([ROOM], vol.Length(max=4)),
    }
}, extra=vol.ALLOW_EXTRA)


def _number(value):
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    return result if math.isfinite(result) else None


def _reading(states, entity_id, units, attribute=None):
    state = states.get(entity_id) if entity_id else None
    if not state or state.state in ("unknown", "unavailable"):
        return None
    unit_key = "temperature_unit" if attribute else "unit_of_measurement"
    unit = state.attributes.get(unit_key)
    if unit not in units:
        return None
    value = _number(state.attributes.get(attribute) if attribute else state.state)
    if value is None:
        return None
    return round((value - 32) * 5 / 9 if unit == "°F" else value, 1)


async def async_setup(hass, config):
    """Register a read-only LAN webhook with a separate key."""
    options = config[DOMAIN]

    async def snapshot(hass, _webhook_id, _request):
        states = hass.states
        weather = states.get(options["weather"])
        outdoor = _reading(states, options["weather"], ("°C", "°F"), "temperature")
        condition = weather.state if weather and re.fullmatch(r"[a-z-]{3,24}", weather.state) else ""
        rooms = []
        for room in options["rooms"]:
            temp = _reading(states, room["temperature"], ("°C", "°F"))
            humidity = _reading(states, room.get("humidity"), ("%",))
            if temp is not None or humidity is not None:
                rooms.append({"name": room["name"], "temperature": temp, "humidity": humidity})
        return web.json_response(
            {"version": 1, "weather": {"temperature": outdoor, "condition": condition}, "rooms": rooms},
            headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
        )

    webhook.async_register(
        hass, DOMAIN, "Free My TV Home", options["webhook_id"],
        snapshot, local_only=True, allowed_methods=["GET"],
    )
    return True
