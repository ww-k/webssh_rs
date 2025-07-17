/**
 * @typedef Option
 * @property {AbortSignal} [signal] AbortSignal，用于终止队列
 * @property {number} [concurrence=5] 并发运行数
 * @property {number} [interval=0] 每个任务执行间的间隔
 */

const defaultOption = {
    concurrence: 5,
    interval: 0,
};
/**
 * @param {Array<Function>} tasks
 * @param {Option} [option]
 * @returns {Promise}
 */
export default function simpleQueueRun(tasks, option) {
    return new Promise((resolve, reject) => {
        if (!(Array.isArray(tasks) && tasks.every((item) => typeof item === 'function'))) {
            return reject(new Error('tasks must be function array'));
        }

        if (tasks.length === 0) {
            return resolve();
        }

        const optionInner = Object.assign({}, defaultOption, option);

        let lastTaskIndex = 0;

        // 创建任务窗口，控制并发
        const execWindows = [];
        execWindows.length = optionInner.concurrence || 5;
        execWindows.fill(null);

        function pushTasks() {
            const min = Math.min(tasks.length, execWindows.length);
            for (let i = 0; i < min; i++) {
                execWindows[i] = tasks[i];
                tasks[i] = null;
            }
            lastTaskIndex = min - 1;
        }
        function runTasks() {
            execWindows.forEach((task, index) => {
                if (typeof task === 'function') {
                    runTask(task, index);
                }
            });
        }
        function runTask(task, index) {
            try {
                const result = task();
                if (result instanceof Promise) {
                    result
                        .then(() => {
                            if (optionInner.interval > 0) {
                                setTimeout(() => releaseAndCallNext(index), optionInner.interval);
                            } else {
                                releaseAndCallNext(index);
                            }
                        })
                        .catch(reject);
                } else {
                    setTimeout(() => releaseAndCallNext(index), optionInner.interval);
                }
            } catch (err) {
                reject(err);
            }
        }
        function releaseAndCallNext(index) {
            if (optionInner.signal?.aborted) {
                return;
            }
            execWindows[index] = null;
            const nextIndex = lastTaskIndex + 1;
            const nextTask = tasks[nextIndex];
            if (nextTask) {
                tasks[nextIndex] = null;
                lastTaskIndex = nextIndex;
                execWindows[index] = nextTask;
                runTask(nextTask, index);
            }
            const allFree = execWindows.every((item) => item === null);
            if (!nextTask && allFree) {
                tasks.length = 0;
                resolve();
            }
        }
        function onAbort() {
            reject(new Error('aborted'));
        }

        if (optionInner.signal) {
            optionInner.signal.addEventListener('abort', onAbort);
        }
        pushTasks();
        runTasks();
    });
}
