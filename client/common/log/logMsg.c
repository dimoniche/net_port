/*
*  Unit: LogMsg.c
*
* Functions to facilitate logging errors and diagnostic messages
*/

#include <sys/types.h>
#include <sys/stat.h>
#include <sys/unistd.h>
#include <stdarg.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <errno.h>

#include <assert.h>

#include "logMsg.h"
//#include "Mutex.h"
//logFd

/* The trailing 0 is a nil pointer, for use by code that iterates over
the array and needs to know where to stop. */
static const char* priName[] = {
        "EMERG",
        "ALERT",
        "CRIT",
        "ERR",
        "WARNING",
        "NOTICE",
        "INFO",
        "DEBUG",
        0
};

static const char* priNameShort[] = {
        "EMRG",
        "ALRT",
        "CRIT",
        "ERR ",
        "WARN",
        "NOTC",
        "INFO",
        "DBUG",
        0
};


/* String sizes */
#define DATEBUF_SIZE        (256)
#define FILEBUF_SIZE        (256)
#define LOG_FNAME_MAX_SIZE  (256)



typedef struct
{
    int logPriority;

    char   logFilename[LOG_FNAME_MAX_SIZE + 1];
    FILE*  logFd;
    int    numberOfBackupFilesToKeep;
    int    usingSyslog; // 1 if we're using syslog, 0 if we're not


    char *logLabel;

    unsigned long logRecordCntr;

} TMsgLog;

static TMsgLog mlog;


int openLogFile(void);
void handleCriticalError(char* fmt, ...);
void rotateFilesIfNecessary();
void rotateFiles();



int logMsgGetPriority()
{
    int result;
    result = mlog.logPriority;
    return result;
}


void logMsgSetPriority(int pri)
{
    assert(pri >= 0 && pri <= LOG_LAST_PRIORITY);

    mlog.logPriority = pri;
}


int logMsgOpen(const char *filename)
{
    assert(strlen(filename) <= FILEBUF_SIZE);
    strncpy(mlog.logFilename, filename, FILEBUF_SIZE);
    mlog.usingSyslog = 0;
    mlog.logPriority = LOG_DEBUG;
    return openLogFile();
}


int openLogFile(void)
{
    if ( !(mlog.logFd = fopen(mlog.logFilename, "a+")) ) {
        handleCriticalError((char*)"logMsg: can't open log file '%s' (errno=%s)",
                            mlog.logFilename, strerror(errno));
        return(-1);
    }

    logMsg(LOG_INFO, "Opened log file '%s'", mlog.logFilename);

    return(0);
}


#ifndef __GNUC__
void logMsg(int pri, const char* fmt, ...)
{
  va_list ap;

  if (pri < 0)
    return;

  if ( pri <= logGetPriority() ) {
    va_start(ap, fmt);
    vlogMsg(pri, "", 0, fmt, ap);
    va_end(ap);
  }
}
#else
void logMsg_impl_(int pri, const char* file, int line, const char* fmt, ...)
{
    va_list ap;

    if (pri <= logMsgGetPriority()) {
        va_start(ap, fmt);
        vlogMsg(pri, file, line, fmt, ap);
        va_end(ap);
    }
}
#endif


void vlogMsg(int pri, const char* file, int line, const char* fmt, va_list ap)
{
    char datebuf[DATEBUF_SIZE];
    int datebufCharsRemaining;
    struct timeval tv;
    time_t timeInSeconds;
    char msbuf[64];
//  int coercedPriority;

    assert (pri >= 0 && pri <= LOG_LAST_PRIORITY);

    if ( gettimeofday(&tv, NULL) == -1 ) {
        /*
         * If we can't get the time of day, don't print a timestamp.
         * (Under Unix, this will never happen:  gettimeofday can fail only
         * if the timezone is invalid [which it can't be, since it is
         * uninitialized] or if &tv or &tz are invalid pointers.)
         */
        datebuf [0] = '\0';
    } else {
        /*
        * The tv_sec field represents the number of seconds passed since
        * the Epoch, which is exactly the argument gettimeofday needs.
        */
        timeInSeconds = (time_t)tv.tv_sec;

        struct tm tm_now = {0};

        if(localtime_r(&timeInSeconds,&tm_now) == NULL) {
          memset(&tm_now, 0, sizeof (tm_now));
          tm_now.tm_mday = 1;
          tm_now.tm_year = 123;
        }

        strftime(datebuf, DATEBUF_SIZE,
                 "%d.%m.%Y-%H:%M:%S", /* guaranteed to fit in 256 chars,
                                 hence don't check return code */
                 &tm_now);
    }

    /*
    * Dividing (without remainder) by 1000 rounds the microseconds
    * measure to the nearest millisecond.
    */
    snprintf(msbuf, sizeof(msbuf), ".%3.3ld", (tv.tv_usec / 1000));

    datebufCharsRemaining = DATEBUF_SIZE - strlen(datebuf);
    strncat(datebuf, msbuf, datebufCharsRemaining - 1);
    /*
    * Just in case strncat truncated msbuf,
    * thereby leaving its last character at
    * the end, instead of a null terminator
    */
    datebuf[DATEBUF_SIZE - 1] = '\0';

    if (mlog.usingSyslog) {
        /*
        * syslog does not recognize priorities conceptually lower (numerically
        * greater) than LOG_DEBUG.  If our current priority is lower, "promote"
        * it to LOG_DEBUG.
        */

    } else {
        //truncate(mlog.logFilename, 5000);

        fprintf(mlog.logFd,
                // printf(
                "%5.5ld %s : %s:%d [%s]:", (++mlog.logRecordCntr)%100000,
                datebuf,
                /*thread_selfId()*/

                /*logMsgGetLabel()*/
                file,
                line,
                priNameShort[pri]
        );
        vfprintf(mlog.logFd, fmt, ap);
        fprintf(mlog.logFd, "\n");
        fflush(mlog.logFd);


//    printf( fmt, ap);
        //   printf( "\n");
        //fflush(mlog.logFd);



        /* in case we just pushed the current file past the size limit... */
        rotateFilesIfNecessary();
    }
}


/*
* Handle a critical error in cpLog itself (an error so bad, by definition,
* it prevents logging in the normal way).  Do this by reverting to using
* standard error as the log "file" and immediately printing a warning about
* the situation.
*/
void handleCriticalError(char* fmt, ...)
{
    va_list ap;

    mlog.logFd = stderr;

    strcpy(mlog.logFilename, "");

    fprintf(mlog.logFd, "\nCRITICAL LOGGING ERROR:\n");

    va_start(ap, fmt);
    vfprintf(mlog.logFd, fmt, ap);
    va_end(ap);

    fprintf(mlog.logFd, "\nLog has reverted to logging to standard error...\n\n");
}




void logMsgShow(void)
{
//  fprintf(stderr, "\tLabel   : %s\n", logMsgGetLabel());
    // fprintf(stderr, "\tPriority: %s\n", priName[logMsgGetPriority()]);
    fprintf(stderr, "\tFile    : %s (logFd = %d)\n",
            mlog.logFilename, /*fileno(mlog.logFd)*/ 1);
}


int logMsgStrToPriority(const char *priority)
{
    const char *p = priority;
    int i = 0;

    if ( strcmp(p, "LOG_") == 0 ) {
        p += 4;
    }

    while (priName[i] != 0) {
        if ( strcmp(p, priName[i]) == 0 )
            return i;
        i++;
    }

    return(-1);
}


const char *logMsgPriorityToStr(int priority)
{
    int priorityCount = 0;

    while (priName[priorityCount] != 0) {
        priorityCount++;
    }

    if ( (priority >= 0) && (priority < priorityCount) )
        return priName[priority];
    else
        return 0;
}


/*
* This function is not called, it is just compiled to make sure that
* the cpLog Macro expansion works
*/
void testLogMacroExpansion()
{
    if (1)
        logMsg(LOG_DEBUG, "this is a test");
    else
        logMsg(LOG_DEBUG, "and a second");
}


void logMsgInit(void)
{
    mlog.logPriority = LOG_DEBUG;
    mlog.logLabel = (char*)malloc(strlen("") + 1);
    assert(mlog.logLabel);
    strcpy(mlog.logLabel, "");

    strcpy(mlog.logFilename, "");
    mlog.logFd = stderr;
    mlog.numberOfBackupFilesToKeep = NUMBER_OF_BACKUP_FILES_TO_KEEP;
    mlog.usingSyslog = 0; /* 1 if we're using syslog, 0 if we're not */

    mlog.logRecordCntr = 0;
}


void logMsgDestroy(void)
{
    free(mlog.logLabel);
}

void rotateFilesIfNecessary()
{
    struct stat fileInfo;

    /* If we are logging to standard error, there are no files to rotate */
    if ((mlog.logFd == stderr) || (mlog.logFd == stdout))
        return;

    /*
    * If we are logging to syslog, log rotation is somebody else's problem
    * (SEP); the log file name is outside of our knowledge,
    * and the file itself may be outside of our permissions
    */
    if (mlog.usingSyslog)
        return;

    /*
    * Test to see if the present log file has exceeded
    * the maximum size - if it has, rotate it
    */
    if ( stat(mlog.logFilename, &fileInfo) ) {
        /* We can't see the log file */
        handleCriticalError((char*)"Log can't stat its own current log file '%s' (errno=%s)",
                            mlog.logFilename, strerror(errno));
        return;
    }

    if (fileInfo.st_size >= SIZE_PER_LOGFILE)
        rotateFiles();
}


/*
* Move the file names, cascading down, so that logfile.1 is renamed
* to logfile.2, logfile.2 is renamed to logfile.3, et cetera.
* logfile.6, if it exists, will be overwritten.
*/
void rotateFiles()
{
    struct stat fileInfo;
    int i;
    char oldFilename[LOG_FNAME_MAX_SIZE + 10], newFilename[LOG_FNAME_MAX_SIZE + 10];

    // mutex_lock(&mlog.fileRotationMutex);

    /*
    * First double-check the log file size, to avoid a race condition.
    * It is possible that, between the time rotateFiles was called and
    * the present moment, some other thread has attempted to log a message
    * (using vlog), noticed that fileInfo.st_size +. SIZE_PER_LOGFILE
    * (in rotateFilesIfNecessary), and rotated the logs out from under us.
    */

    if ( stat(mlog.logFilename, &fileInfo) != 0 )
        handleCriticalError((char*)"rotateFiles can't stat the log file '%s'",
                            mlog.logFilename);

    if (fileInfo.st_size < SIZE_PER_LOGFILE)
        /*
        * The race condition occurred;
        * our files have already been moved for us
        */
        return;

    /* Close the current log file..... */
    if ( fclose(mlog.logFd) != 0 )
        handleCriticalError((char*)"Can't close the log file (errno=%s)",
                            strerror(errno));

    /* Prepare to move the files. */
    for (i = mlog.numberOfBackupFilesToKeep - 1; i >= 0; i--) {
//    string oldFilename (cpLogFilename);
//    oldFilename += itos(i);
//    string newFilename (cpLogFilename);
//    newFilename += itos(i + 1);
        if (i)
            snprintf(oldFilename, sizeof(oldFilename), "%s%d", mlog.logFilename, i);
        else
            snprintf(oldFilename, sizeof(oldFilename), "%s", mlog.logFilename);
        snprintf(newFilename, sizeof(oldFilename), "%s%d", mlog.logFilename, i + 1);

        if ( stat(oldFilename, &fileInfo) == 0 ) {
            /* if the file _does_ exist... */
            if ( rename(oldFilename, newFilename) != 0 ) {
                /* If rename() fails... */
                /* Serious problems are afoot. */
                handleCriticalError((char*)"Log can't rename '%s' to '%s' (errno=%s)",
                                    oldFilename, newFilename, strerror(errno));
                return;
            }
        } else
        if (errno != ENOENT) {
            /*
            * The only reason the file should be un-stat-able is that it
            * does not exist.  That is a legitimate condition, since rotation may
            * not yet have created a file with that number (i).  Any other failure
            * is an error.
            */
            handleCriticalError((char*)"Log can't stat '%s' (errno=%s)",
                                oldFilename, strerror(errno));
            return;
        }
    }

    /*
    * Open the log file for writing once more
    * (The current log file will always have the name
    * stored in cpLogFilename, without a numeric extension.)
    */
    openLogFile();

    //mutex_unlock(&mlog.fileRotationMutex);
}
