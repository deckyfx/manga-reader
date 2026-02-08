"""
Health and status endpoint handlers.
"""

from ..response_models import HealthResponse, StatusResponse, ModelStatus
from .. import state


async def health_check() -> HealthResponse:
    """
    Health check endpoint (for Docker healthcheck).
    Returns healthy as soon as server is accepting connections.
    """
    return HealthResponse(
        status="healthy",
        model_loaded=state.ocr_ready and state.animelama_ready,
        build_id=state.BUILD_ID,
    )


async def status() -> StatusResponse:
    """
    Model readiness status endpoint.
    Reports loading state of each model independently.
    """
    return StatusResponse(
        models={
            "ocr": ModelStatus(name=state.OCR_MODEL_NAME, ready=state.ocr_ready),
            "cleaner": ModelStatus(name=state.ANIMELAMA_MODEL_NAME, ready=state.animelama_ready),
        }
    )
