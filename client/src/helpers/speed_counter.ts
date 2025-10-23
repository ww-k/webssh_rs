type IRecordTimeupCallback = (record: (loaded: number) => number) => void;

/**
 * 通用的计速器. 固定频率打点记录一个数据总量, 并计算当前速度, 并保留最近一定数量的历史记录, 返回该段记录的平均值
 */
export default function SpeedCounter(
    option = {
        /** 计算频率, 单位ms. */
        interval: 500,
        /** 历史记录条数 */
        histsize: 10,
    },
) {
    option = option || {};
    const interval = option.interval || 500;
    //保存最近N次计算的速度，算平均值
    const histsize = option.histsize || 10;
    let loaded = 0;
    /** 上次计算的时间 */
    let lastTime: Date;
    /** 上次计算的速度 */
    let lastSpeed: number;
    /** 最近速度的历史记录 */
    let speeds: number[] = [];
    /** 计算速度前的回调函数 */
    let recordTimeupCallback: IRecordTimeupCallback | undefined;

    let timer: number | undefined;
    function start() {
        if (timer) {
            return;
        }
        lastTime = new Date();
        timer = setInterval(() => caculate(), interval);
    }

    function end() {
        clearInterval(timer);
        timer = undefined;
        recordTimeupCallback = undefined;
    }

    function caculate() {
        try {
            if (recordTimeupCallback) {
                recordTimeupCallback((_loaded) => {
                    loaded = _loaded || 0;
                    return lastSpeed;
                });
            }
        } catch (err) {
            console.warn(err);
        }
        /** 两次计算间的间隔毫秒数 */
        const now = new Date();
        // @ts-ignore
        const _interval = now - lastTime;
        lastTime = now;

        const curSpeed = (loaded * 1000) / _interval;

        //保存最近N次计算的速度，算平均值
        if (speeds.length >= histsize) {
            speeds = speeds.slice(1, histsize);
        }
        speeds.push(curSpeed);
        lastSpeed = averageSpeed(speeds);
        return lastSpeed;
    }

    /** 计算历史速度的平均值 */
    function averageSpeed(speeds: number[]) {
        let sum = 0;
        speeds.forEach((speed) => {
            sum += speed;
        });
        return sum / speeds.length;
    }

    return {
        start,
        end,
        get: () => lastSpeed,
        onRecordTimeup: (callback: IRecordTimeupCallback) => {
            if (typeof callback === "function") {
                recordTimeupCallback = callback;
            }
        },
    };
}
