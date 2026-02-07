"""
Health and status endpoint handlers.
"""

from ..models import HealthResponse, StatusResponse, ModelStatus
from .. import state


async def health_check() -> HealthResponse:
    """
    Health check endpoint (for Docker healthcheck).
    Returns healthy as soon as server is accepting connections.
    """
    return HealthResponse(
        status="healthy",
        model_loaded=state.ocr_ready and state.cleaner_ready,
        cleaner_mode=state.cleaner_mode,
        build_id=state.BUILD_ID,
    )


async def status() -> StatusResponse:
    """
    Model readiness status endpoint.
    Reports loading state of each model independently.
    """
    cleaner_name = (
        state.CLEANER_MODEL_NAME_LAMA
        if state.cleaner_mode == "lama"
        else state.CLEANER_MODEL_NAME_OPENCV
    )
    return StatusResponse(
        models={
            "ocr": ModelStatus(name=state.OCR_MODEL_NAME, ready=state.ocr_ready),
            "cleaner": ModelStatus(name=cleaner_name, ready=state.cleaner_ready),
        }
    )
