export type EventListener = (eventName: string, data?: any) => void;

export class AgentBus {
    private listeners: Map<string, EventListener[]> = new Map();

    constructor() {
        console.log("[AgentBus] Initialized.");
    }

    /**
     * Subscribes a listener to a specific event.
     * @param eventName The name of the event to subscribe to.
     * @param listener The callback function to execute when the event is published.
     */
    subscribe(eventName: string, listener: EventListener): void {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName)!.push(listener);
        console.log(`[AgentBus] Listener subscribed to event: ${eventName}`);
    }

    /**
     * Unsubscribes a listener from a specific event.
     * @param eventName The name of the event to unsubscribe from.
     * @param listener The callback function to remove.
     */
    unsubscribe(eventName: string, listener: EventListener): void {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners) {
            const index = eventListeners.indexOf(listener);
            if (index > -1) {
                eventListeners.splice(index, 1);
                console.log(`[AgentBus] Listener unsubscribed from event: ${eventName}`);
                if (eventListeners.length === 0) {
                    this.listeners.delete(eventName);
                }
            }
        }
    }

    /**
     * Publishes an event to all subscribed listeners.
     * @param eventName The name of the event to publish.
     * @param data Optional data to pass to the listeners.
     */
    publish(eventName: string, data?: any): void {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners && eventListeners.length > 0) {
            console.log(`[AgentBus] Publishing event: ${eventName} with data:`, data);
            // Iterate over a copy of the listeners array in case a listener unsubscribes itself during execution
            [...eventListeners].forEach(listener => {
                try {
                    listener(eventName, data);
                } catch (error) {
                    console.error(`[AgentBus] Error in listener for event ${eventName}:`, error);
                }
            });
        } else {
            // console.log(`[AgentBus] No listeners for event: ${eventName}`);
        }
    }
}
```
