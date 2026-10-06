import { incidentsRepository } from './incidents.repository.js';

export const incidentsService = {
  /** Caller must have verified that the monitor belongs to the user. */
  listForMonitor(monitorId: string, limit: number) {
    return incidentsRepository.listForMonitor(monitorId, limit);
  },
};
