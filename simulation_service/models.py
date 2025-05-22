from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

class SimulationCreateRequest(BaseModel):
    agentId: str = Field(..., description="Path or identifier for the agent definition YAML.")
    initialInput: str = Field(..., description="The initial input or task for the agent.")
    mockConfigurations: Optional[Dict[str, Any]] = Field(None, description="Optional configurations for mocking system or tools.")

class SimulationCreateResponse(BaseModel):
    simulationId: str = Field(..., description="Unique ID for the created simulation.")

class SimulationControlRequest(BaseModel):
    command: str = Field(..., description="Control command for the simulation (e.g., 'pause', 'resume', 'step', 'stop').")

# Example of an event structure that might be streamed
class SimulationEvent(BaseModel):
    type: str # e.g., 'info', 'thought', 'action', 'tool_response', 'reflection'
    data: Any
    timestamp: float
    step: Optional[int] = None # Add step to the event data
    simulation_id: Optional[str] = None # Add simulation_id for context
```
