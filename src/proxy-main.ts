/**
 * 代理服务独立启动入口（后台进程使用）。
 */

import { startProxy } from "./proxy.js";
import {
  applyMeluRuntimeContextEnv,
  createMeluRuntimeContext,
} from "./runtime-context.js";

const memoryName = process.env.MELU_MEMORY_PATH || process.env.MELU_MEMORY || null;
const runtimeContext = createMeluRuntimeContext(process.env.MELU_RUN_ID || null);
applyMeluRuntimeContextEnv(runtimeContext);
startProxy(memoryName, runtimeContext);
