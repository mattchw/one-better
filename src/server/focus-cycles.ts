import 'server-only';
import {cycleRepository} from '../modules/focus-cycles/repository';
import {cycleService} from '../modules/focus-cycles/service';
import {runtime} from './runtime';
import {executionClock} from './execution-clock';
export const focusCycles=()=>cycleService(cycleRepository(runtime().db),executionClock);
