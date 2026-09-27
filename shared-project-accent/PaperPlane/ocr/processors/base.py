from abc import ABC, abstractmethod
from typing import List, Dict, Any
from pydantic import BaseModel, model_validator

# Shared models
class FlightEntry(BaseModel):
    date: str = ""
    tailNumber: str = ""
    srcIcao: str = ""
    destIcao: str = ""
    totalFlightTime: float = 0
    picTime: float = 0
    dualReceivedTime: float = 0
    instrumentTime: float = 0
    crossCountry: bool = False
    night: bool = False
    solo: bool = False
    dayLandings: int = 0
    nightLandings: int = 0
    remarks: str = ""

    @model_validator(mode="before")
    @classmethod
    def keep_unreadable_fields_for_review(cls, values):
        if not isinstance(values, dict):
            return values
        return {
            key: (cls.model_fields[key].default if value is None and key in cls.model_fields else value)
            for key, value in values.items()
        }

class OCRResult(BaseModel):
    message: str
    records: List[FlightEntry]

class OCRProcessor(ABC):
    @abstractmethod
    async def process_image(self, file_bytes: bytes, mime_type: str = "image/jpeg") -> OCRResult:
        """
        Process the image bytes and return the extracted flight records.
        """
        pass
