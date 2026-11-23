from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ChunkOut(BaseModel):
    chunk_index: int
    content: str
    token_count: int
    metadata: Dict = Field(default_factory=dict)


class ParseChunkResponse(BaseModel):
    parser: str
    page_count: Optional[int] = None
    char_count: int
    chunk_count: int
    chunks: List[ChunkOut]
