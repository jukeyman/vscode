import asyncio
import uuid
import yaml # PyYAML
from typing import Dict, Any, AsyncGenerator, Optional
import time # For timestamps
import os # For path operations

# Agent Loader
class AgentDefinitionError(Exception):
    """Custom exception for agent definition loading errors."""
    pass

def load_agent_definition(agent_file_path: str, base_agents_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Loads an agent definition from a YAML file.
    Validates that the path is within an allowed directory if base_agents_dir is provided.
    Raises AgentDefinitionError for file not found, YAML parsing issues, or path traversal.
    """
    if base_agents_dir:
        # Ensure the path is absolute and within the base_agents_dir
        abs_agent_file_path = os.path.abspath(os.path.join(base_agents_dir, agent_file_path))
        abs_base_agents_dir = os.path.abspath(base_agents_dir)
        
        if not abs_agent_file_path.startswith(abs_base_agents_dir):
            raise AgentDefinitionError(f"Path traversal detected or invalid path: {agent_file_path}")
    else:
        # If no base_agents_dir, resolve the path as is (e.g., relative to CWD or absolute)
        # This might be less secure if paths are not carefully controlled by the caller.
        abs_agent_file_path = os.path.abspath(agent_file_path)


    if ".." in agent_file_path: # Double check relative path components even if made absolute
        raise AgentDefinitionError(f"Invalid agent file path (contains '..'): {agent_file_path}")
        
    try:
        with open(abs_agent_file_path, 'r') as f:
            data = yaml.safe_load(f)
            if not isinstance(data, dict):
                raise AgentDefinitionError(f"Invalid YAML format: Expected a dictionary in {abs_agent_file_path}")
            return data
    except FileNotFoundError:
        raise AgentDefinitionError(f"Agent definition file not found at {abs_agent_file_path}")
    except yaml.YAMLError as e:
        raise AgentDefinitionError(f"Error parsing YAML in {abs_agent_file_path}: {e}")
    except Exception as e:
        raise AgentDefinitionError(f"An unexpected error occurred while loading agent {abs_agent_file_path}: {e}")


class Simulation:
    def __init__(self, agent_id_path: str, initial_input: str, simulation_id: str, mock_configs: Optional[Dict[str, Any]] = None, base_agents_dir: Optional[str] = None):
        self.agent_id_path = agent_id_path
        self.initial_input = initial_input
        self.simulation_id = simulation_id
        self.mock_configurations = mock_configs or {}
        self.base_agents_dir = base_agents_dir # Store for potential reloads or context
        
        try:
            self.agent_definition = load_agent_definition(agent_id_path, self.base_agents_dir)
        except AgentDefinitionError as e:
            print(f"Critical Error loading agent definition for '{agent_id_path}': {e}")
            self.agent_definition = {
                "name": f"ErrorLoading-{os.path.basename(agent_id_path)}", 
                "description": "Failed to load agent definition.",
                "error": str(e)
            }
            # Simulation can proceed to report this error via event stream

        self.is_running = False
        self.is_paused = False
        self.stop_requested = False # Flag to signal stop
        self.log_queue = asyncio.Queue()
        self.current_step = 0
        self.max_steps = self.agent_definition.get("simulation_max_steps", 5) # Example: configurable max steps

    async def _log(self, message_type: str, data: Any):
        event_data = {
            "type": message_type,
            "data": data,
            "timestamp": time.time(),
            "simulation_id": self.simulation_id,
            "step": self.current_step
        }
        await self.log_queue.put(event_data)
        print(f"[Sim {self.simulation_id} Step {self.current_step}] Event: {message_type} - Data: {data}")

    async def run_loop(self):
        self.is_running = True
        self.is_paused = False
        self.stop_requested = False

        if "error" in self.agent_definition:
            await self._log("error", f"Simulation '{self.simulation_id}' cannot start: {self.agent_definition['error']}")
            self.is_running = False
            await self.log_queue.put(None) # Signal end of stream
            return

        await self._log("info", f"Simulation '{self.simulation_id}' started for agent: {self.agent_definition.get('name', self.agent_id_path)} with input: '{self.initial_input}'. Max steps: {self.max_steps}")

        for i in range(self.max_steps):
            if self.stop_requested:
                await self._log("info", "Simulation stop requested by control command.")
                break 
            
            while self.is_paused:
                if self.stop_requested:
                    break
                await self._log("info", "Simulation paused.")
                await asyncio.sleep(0.5) 
            
            if self.stop_requested: # Break outer loop if stopped while paused
                 await self._log("info", "Simulation stopped by control command while paused.")
                 break

            self.current_step = i + 1
            await self._log("info", f"Executing step {self.current_step}...")

            await self._log("thought", f"Agent '{self.agent_definition.get('name')}' is thinking about: '{self.initial_input if self.current_step == 1 else 'previous_step_output'}'...")
            await asyncio.sleep(0.5) 

            mock_action_name = self.mock_configurations.get("action_name", "mock_tool_alpha")
            action_args_from_config = self.mock_configurations.get("action_args", {})
            action_args = {"param1": f"value_step_{self.current_step}", **action_args_from_config}

            action = {"tool_name": mock_action_name, "args": action_args}
            await self._log("action", f"Agent decided to call tool: {action['tool_name']} with args: {action['args']}")
            await asyncio.sleep(0.5)

            tool_response_content = self.mock_configurations.get("tool_response", f"Mock tool {action['tool_name']} executed successfully for step {self.current_step}.")
            tool_response = {"status": "success", "result": tool_response_content}
            await self._log("tool_response", f"Tool '{action['tool_name']}' responded: {tool_response}")
            await asyncio.sleep(0.5)

            await self._log("reflection", f"Agent is reflecting on the tool response from step {self.current_step}...")
            await asyncio.sleep(0.5)
            
            if self.current_step >= self.max_steps :
                await self._log("info", f"Simulation '{self.simulation_id}' reached max steps ({self.max_steps}).")
                break 

        if not self.stop_requested:
            await self._log("info", f"Simulation '{self.simulation_id}' completed all steps.")
        
        self.is_running = False
        self.is_paused = False
        await self.log_queue.put(None) # Signal end of stream by putting None

    async def get_event_stream(self) -> AsyncGenerator[Dict[str, Any], None]:
        while True:
            event = await self.log_queue.get()
            if event is None: 
                self.log_queue.task_done()
                break
            yield event
            self.log_queue.task_done()
        print(f"Event stream ended for simulation {self.simulation_id}")
    
    def request_stop(self):
        """Signals the simulation to stop gracefully."""
        if self.is_running:
            self.stop_requested = True
            self.is_paused = False # Ensure it's not stuck in paused state
            print(f"Stop requested for simulation {self.simulation_id}. Loop will terminate at next check.")
        else:
            print(f"Simulation {self.simulation_id} is not running or already stopping, stop request ignored.")
            # If it's not running and we want to ensure the queue is cleared for consumers:
            if self.log_queue.empty(): # Or some other condition to ensure it's safe
                 asyncio.create_task(self.log_queue.put(None))


simulations: Dict[str, Simulation] = {}
# Define a base directory for agent YAML files for security
# This should be an absolute path or resolved from the service's root directory.
# For local testing, this might be relative to where you run uvicorn.
# Example: if service is in 'simulation_service' and agents in 'agents_data' at same level:
BASE_AGENTS_DIRECTORY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agents_data")


async def create_simulation_instance(agent_id_path: str, initial_input: str, mock_configs: Optional[Dict[str, Any]] = None) -> str:
    """
    Creates and starts a new simulation instance.
    agent_id_path is relative to BASE_AGENTS_DIRECTORY.
    """
    simulation_id = str(uuid.uuid4())

    # Validate that BASE_AGENTS_DIRECTORY exists
    if not os.path.isdir(BASE_AGENTS_DIRECTORY):
        print(f"Error: BASE_AGENTS_DIRECTORY '{BASE_AGENTS_DIRECTORY}' does not exist or is not a directory.")
        # This is a server configuration error, might need specific handling or raise an exception
        # For now, the load_agent_definition will fail if base_agents_dir is invalid.
        # However, it's good practice to check it here.
        # For simplicity, we'll let load_agent_definition handle it.
    
    sim = Simulation(
        agent_id_path=agent_id_path, # This is now relative to BASE_AGENTS_DIRECTORY
        initial_input=initial_input, 
        simulation_id=simulation_id,
        mock_configs=mock_configs,
        base_agents_dir=BASE_AGENTS_DIRECTORY # Pass the base directory
    )
    simulations[simulation_id] = sim
    asyncio.create_task(sim.run_loop())
    return simulation_id

def get_simulation_instance(simulation_id: str) -> Optional[Simulation]:
    return simulations.get(simulation_id)

def control_simulation_instance(simulation_id: str, command: str) -> bool:
    sim = get_simulation_instance(simulation_id)
    if not sim:
        return False
    
    if command == "stop":
        sim.request_stop()
        return True
    elif command == "pause":
        if sim.is_running and not sim.is_paused:
            sim.is_paused = True
            asyncio.create_task(sim._log("info", "Simulation paused by control command."))
            return True
    elif command == "resume":
        if sim.is_running and sim.is_paused:
            sim.is_paused = False
            asyncio.create_task(sim._log("info", "Simulation resumed by control command."))
            return True
    # Step command would be more complex, involving manual advancement of the loop
    print(f"Command '{command}' not fully implemented or invalid state for simulation '{simulation_id}'.")
    return False

# Cleanup old simulations (optional, basic example)
async def cleanup_simulations():
    # This is a very basic cleanup. In a real app, track active SSE connections
    # or simulation end times.
    while True:
        await asyncio.sleep(3600) # Check every hour
        current_time = time.time()
        sims_to_delete = []
        for sim_id, sim in simulations.items():
            # Example: remove if not running and queue is empty (implicitly ended)
            # Or if it's been inactive for a long time.
            if not sim.is_running and sim.log_queue.empty(): 
                 # Check if last event was long ago (e.g. > 1 hour)
                 # This requires storing last_event_time in Simulation object
                 sims_to_delete.append(sim_id)
        
        for sim_id in sims_to_delete:
            print(f"Cleaning up inactive simulation: {sim_id}")
            del simulations[sim_id]

# If you want cleanup to run:
# asyncio.create_task(cleanup_simulations())
```
