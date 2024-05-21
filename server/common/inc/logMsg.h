#ifndef __LOGMSG_H__
#define __LOGMSG_H__


#include <stdarg.h>
#include <stdio.h>  /* For FILE */


//#include "Thread.h"


/*
* The maximum size for a single log file.  After the file reaches this
* size, it will automatically be archived by the file-rotation algorithm.
* (see rotateFiles)
*/
#define SIZE_PER_LOGFILE                (5000000) /* in bytes */

#define NUMBER_OF_BACKUP_FILES_TO_KEEP  (3)

/*
* Priority levels
* These are the priority levels of logged messages.  LOG_EMERG through
* LOG_DEBUG are lifted directly from the priority system in Unix syslog.
*
* the #ifndef protects these values from being clobbered by values
* of the same name in Unix syslog.h
*/
#ifndef LOG_EMERG
/* system is unusable */
#define LOG_EMERG       0
/* action must be taken immediately */
#define LOG_ALERT       1
/* critical conditions */
#define LOG_CRIT        2
/* error conditions */
#define LOG_ERR         3
/* warning conditions */
#define LOG_WARNING     4
/* normal but significant condition */
#define LOG_NOTICE      5
/* informational */
#define LOG_INFO        6
/* debug-level messages */
#define LOG_DEBUG       7

#define LOG_WARN LOG_WARNING
#endif

/* an alias for the last priority level, for use in bounds-checking code */
#define LOG_LAST_PRIORITY 7


#ifdef __cplusplus
extern "C" {
#endif

/*
* Generate a log message using a printf-style format string and option arguments.
* This function should not be called directly; it exists only as a helper function
* for the cpLog macro, which in turn is defined only if we are using the GNU
* C compiler (i.e. if the preprocessor macro __GNUC__ is defined).
*
*   pri  - the priority to assign to this message
*   file - the file that contains the code that is calling cpLog
*   line - the specific line in the file where cpLog is being called
*   fmt  - a printf-style format string
*   ...  - any number of additional values to substitute into the string,
*          according to printf rules
*/
extern void logMsg_impl_(int pri, const char* file, int line, const char* fmt, ...);

/*
* Generate a log message using a vprintf-style format string and option arguments.
* This function should not be called directly; it exists only as a helper function
* for cpLog, which in turn is defined only if we are using the GNU
* C compiler (i.e. if the preprocessor macro __GNUC__ is defined).
*   pri  - the priority to assign to this message
*   file - the file that contains the code that is calling cpLog
*   line - the specific line in the file where cpLog is being called
*   fmt  - a printf-style format string
*   ap   - a va_list (varaible-argument list), used to pass variable arguments around
*/
void vlogMsg(int pri, const char* file, int line, const char* fmt, va_list ap);

#ifdef __GNUC__
/*
* Implement cpLog as a macro only if we are using the GNU C compiler, i.e. if
* __GNUC__ is defined.  The GNU C compiler defines __FILE__ and __LINE__
* preprocessor macros that we can use to tell clog_impl_ exactly where the
* calling code is located, allowing for easier debugging.
*/
#define logMsg(priority__, fmt__, args__...) \
do { \
  if (priority__ <= logMsgGetPriority()) \
    logMsg_impl_(priority__, __FILE__, __LINE__, fmt__ , ##args__);} \
while (0)
#else
/*
* If GNU C's __FILE__ and __LINE__ macros are unavailable, use the regular
* log function, which omits that information.
*
*   pri - the priority to assign to this message
*   fmt - a printf-style format string
*   ... - any number of additional values to substitute into the string,
*         according to printf rules
*/
extern void logMsg(int pri, const char *fmt, ...);
#endif

/*
* Set the priority level at which messages should be printed (for the current
* thread).  Messages of a priority level conceptually greater than or equal
* to this number (numerically less than or equal) are printed.  Messages with
* conceptually lower (numerically higher) priorities than this level are
* ignored.  Don't blame us for the backwards semantics; syslog started them!
*
*   pri - the new priority level
*/
extern void logMsgSetPriority(int pri);

/*
* Get the current priority level (for the current thread).
*
*  return - the current priority level
*/
extern int logMsgGetPriority();

/*
* Set the priority level at which messages should be printed
* for a particular thread, in a thread-safe manner.
*
*   thread_id - a designator for the thread
*   pri       - the new priority level
*/
//extern void logMsgSetPriorityThread(thread_t thread_id, int pri);

/*
* Set the priority level for a particular thread to an undefined value.
*
*   thread_id - a designator for the thread
*/
//extern void logMsgClearPriorityThread(thread_t thread_id);

/*
* Give a thread a desciptive label, which will be included in all the log
* messages that come from that thread.
*
*   thread_id - a designator for the thread
*   label     - the label
*/
//extern void logMsgSetLabelThread(thread_t thread_id, const char* label);

/*
* Remove a thread's descriptive label, so that no special identifier will
* be included in log messages it sends.
*
*   thread_id - a designator for the thread
*/
//extern void logMsgClearLabelThread(thread_t thread_id);

/*
* Give the current thread a descriptive label, which will be included in all
* the log messages it sends.  Every program should call logSetLabel
* before it begins logging.
*   label - the label
*/
//extern void logMsgSetLabel(const char *label);

/*
* Print to standard error the current label, priority, and log file path.
*/
extern void logMsgShow(void);

/*
* Start logging to the Unix syslog facility, rather than to a file.
*/
void logMsgOpenSyslog(void);

/*
* Open a log file.  A program should call logOpen when it wants to begin
* logging to a file, as opposed to some other sink like standard error.
*
*   filename - the path to the file
*   return 0 if the log file was successfully opened for writing,
*   (-1) otherwise
*/
extern int logMsgOpen(const char* filename);

/*
* Given a string with a descriptive name for a priority level, return the
* number that is the priority level itself.
*
*   priority - a descriptive name for a priority level
*   return the priority level, or -1 if the string is not a recognized name
*   for any level
*/
extern int logMsgStrToPriority(const char *priority);

/*
* Given a numerical priority level, return a descriptive name for that level.
*
*   priority - the numerical priority level
*   return a descriptive name, or a null pointer if the number passed in
*   does not correspond to a recognized priority level
*/
extern const char *logMsgPriorityToStr(int priority);


/*
* This two functions is NOT thread-safed.
* Function logMsgInit must be called only from main thread,
* before starting multitreading, and logMsgDestroy must be called
* when multitreading is done (before main exiting)
*/
void logMsgInit(void);
void logMsgDestroy(void);


#ifdef __cplusplus
}
#endif

#endif /* __LOGMSG_H__ */

