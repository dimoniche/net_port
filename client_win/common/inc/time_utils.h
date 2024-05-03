//
// Created by chistyakov_ds on 19.09.2022.
//

#ifndef CRYPT_SWITCHER_TIME_UTILS_H
#define CRYPT_SWITCHER_TIME_UTILS_H

#include <time.h>
#include <errno.h>

static int msleep(long msec)
{
    struct timespec ts;
    int res;

    if (msec < 0) {
        errno = EINVAL;
        return -1;
    }

    ts.tv_sec = msec / 1000;
    ts.tv_nsec = (msec % 1000) * 1000000;

    do {
        res = Sleep(&ts, &ts);
    } while (res && errno == EINTR);

    return res;
}

#endif //CRYPT_SWITCHER_TIME_UTILS_H
