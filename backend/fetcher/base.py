from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from abc import ABC, abstractmethod


@dataclass
class RawArticle:
    url: str
    title: str
    source_name: str
    source_type: str
    content: str = ""
    published_at: Optional[datetime] = None
    tag_hint: Optional[str] = None


class BaseFetcher(ABC):
    @abstractmethod
    def fetch(self) -> list[RawArticle]:
        ...
