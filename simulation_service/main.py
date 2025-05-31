from fastapi import FastAPI, HTTPException, Body, Request
from sse_starlette.sse import EventSourceResponse
import asyncio
import json # For SSE data serialization
import os # For path operations

from .models import SimulationCreateRequest, SimulationCreateResponse, SimulationControlRequest
# Use the new function names from simulation_manager
from .simulation_manager import create_simulation_instance, get_simulation_instance, control_simulation_instance, AgentDefinitionError, BASE_AGENTS_DIRECTORY

app = FastAPI(title="Agent Simulation Service")

@app.on_event("startup")
async def startup_event():
    # Ensure the base agents directory exists on startup
    if not os.path.isdir(BASE_AGENTS_DIRECTORY):
        try:
            os.makedirs(BASE_AGENTS_DIRECTORY)
            print(f"Created BASE_AGENTS_DIRECTORY at {BASE_AGENTS_DIRECTORY}")
        except OSError as e:
            print(f"Error creating BASE_AGENTS_DIRECTORY at {BASE_AGENTS_DIRECTORY}: {e}")
            # Depending on strictness, you might want to raise an exception or exit
    else:
        print(f"Using existing BASE_AGENTS_DIRECTORY: {BASE_AGENTS_DIRECTORY}")


@app.post("/simulations", response_model=SimulationCreateResponse)
async def handle_create_simulation(request_data: SimulationCreateRequest = Body(...)):
    """
    Creates a new agent simulation instance.
    The `agentId` should be a path to the agent's YAML definition file,
    relative to the pre-configured `BASE_AGENTS_DIRECTORY`.
    """
    try:
        print(f"Received request to create simulation for agent: {request_data.agentId} with input: '{request_data.initialInput}'")

        # agentId is now treated as relative to BASE_AGENTS_DIRECTORY
        # The actual path joining and validation happens in load_agent_definition
        simulation_id = await create_simulation_instance(
            agent_id_path=request_data.agentId, # This is the relative path
            initial_input=request_data.initialInput,
            mock_configs=request_data.mockConfigurations
        )
        return SimulationCreateResponse(simulationId=simulation_id)
    except AgentDefinitionError as e:
        raise HTTPException(status_code=400, detail=f"Failed to create simulation: {str(e)}")
    except Exception as e:
        print(f"Unexpected error creating simulation: {e}")
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")


@app.get("/simulations/{simulation_id}/events")
async def handle_simulation_events(simulation_id: str, request: Request):
    """
    Streams simulation events for a given simulation ID using Server-Sent Events (SSE).
    """
    sim = get_simulation_instance(simulation_id)
    if not sim:
        raise HTTPException(status_code=404, detail="Simulation not found or already ended.")

    async def event_generator():
        client_disconnected = False
        # Keep track of the disconnect task to cancel it properly
        disconnect_check_task = None

        async def check_disconnect():
            nonlocal client_disconnected
            try:
                while True:
                    if await request.is_disconnected():
                        print(f"Client for sim {simulation_id} disconnected.")
                        client_disconnected = True
                        # If simulation has a mechanism to stop event generation or cleanup
                        if hasattr(sim, 'request_stop'): # Or a more specific method
                            sim.request_stop() # Attempt to gracefully stop the simulation
                        break
                    await asyncio.sleep(0.1) # Check periodically
            except asyncio.CancelledError:
                print(f"Disconnect check task cancelled for sim {simulation_id}.")
                # Ensure client_disconnected is set if task is cancelled externally
                client_disconnected = True


        disconnect_check_task = asyncio.create_task(check_disconnect())

        try:
            async for event_data in sim.get_event_stream():
                if client_disconnected:
                    print(f"Client disconnected for sim {simulation_id}, stopping event stream generation.")
                    break
                yield {"event": event_data.get("type", "message"), "data": json.dumps(event_data)}
        except asyncio.CancelledError:
            print(f"Event stream for {simulation_id} was cancelled by server logic (e.g. on shutdown or control).")
        finally:
            if disconnect_check_task and not disconnect_check_task.done():
                disconnect_check_task.cancel()
                try:
                    await disconnect_check_task # Allow task to process cancellation
                except asyncio.CancelledError:
                    pass # Expected
            print(f"Finished streaming events for simulation {simulation_id}")

    return EventSourceResponse(event_generator())


@app.post("/simulations/{simulation_id}/control", status_code=200)
async def handle_simulation_control(simulation_id: str, request_data: SimulationControlRequest = Body(...)):
    """
    Sends a control command to an active simulation.
    Supported commands: 'stop', 'pause', 'resume'.
    """
    command = request_data.command.lower()
    print(f"Control command '{command}' received for simulation '{simulation_id}'.")

    if control_simulation_instance(simulation_id, command):
        return {"status": "success", "message": f"Command '{command}' acknowledged for simulation '{simulation_id}'."}
    else:
        # Check if simulation exists to provide a more specific error
        sim = get_simulation_instance(simulation_id)
        if not sim:
            raise HTTPException(status_code=404, detail="Simulation not found.")
        else: # Simulation exists but command failed (e.g., invalid state for command)
            raise HTTPException(status_code=400, detail=f"Command '{command}' could not be processed for simulation '{simulation_id}'. It might be in an invalid state for this command or the command is not supported in the current state.")

# To run (from the root directory of your project, where 'simulation_service' folder is):
# 1. Create 'agents_data' directory at the project root (sibling to 'simulation_service').
# 2. Place your agent YAML files (e.g., sample_agent.yaml) in 'agents_data'.
#    Example sample_agent.yaml:
#    name: Sample Agent Alpha
#    description: A basic agent for testing.
#    simulation_max_steps: 4
#
# 3. Run the service:
#    uvicorn simulation_service.main:app --reload --port 8001
#
# Example POST to create simulation (using curl or httpie):
# http POST http://localhost:8001/simulations agentId="sample_agent.yaml" initialInput="Process this document" mockConfigurations:='{"action_name": "custom_tool_xyz"}'
#
# Then connect to SSE endpoint:
# http http://localhost:8001/simulations/{simulation_id_from_response}/events
#
# Example POST to control simulation:
# http POST http://localhost:8001/simulations/{simulation_id}/control command="pause"
# http POST http://localhost:8001/simulations/{simulation_id}/control command="resume"
# http POST http://localhost:8001/simulations/{simulation_id}/control command="stop"
```
