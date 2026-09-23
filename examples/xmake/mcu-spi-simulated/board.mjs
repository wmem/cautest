import {SimulatedMcuBoard} from '@cautest/config';
// This is a host protocol simulation, not a physical MCU or SPI verification.
// Real factories receive {projectRoot, options, origin, signal}; honor cancellation.
export function create({options, signal}) {
    signal?.throwIfAborted();
    return new SimulatedMcuBoard(options);
}
