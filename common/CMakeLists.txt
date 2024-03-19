cmake_minimum_required(VERSION 3.7)
set(CMAKE_C_STANDARD 11)

set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_C_COMPILER arm-linux-gnueabihf-gcc)
set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)

set(proxy_common_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/log/logMsg.c
        ${CMAKE_CURRENT_LIST_DIR}/db/db.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/memory/lib_memory.c
        ${CMAKE_CURRENT_LIST_DIR}/event/make_event.c
        ${CMAKE_CURRENT_LIST_DIR}/event/db_ref_tables.c
        )

set(proxy_common_linux_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/hal/time/unix/time.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/thread/linux/thread_linux.c
        )

set(PostgreSQL_LIBRARY /usr/lib/arm-linux-gnueabihf/libpq.so)
set(PostgreSQL_INCLUDE_DIRS "\\usr\\include\\postgresql")

link_directories(${PostgreSQL_LIBRARY_DIRS})

include_directories (
        .
        ${PostgreSQL_INCLUDE_DIRS}
        ${CMAKE_CURRENT_LIST_DIR}/inc
)

include (GenerateExportHeader)

add_library (proxy_common ${proxy_common_SRCS} ${proxy_common_linux_SRCS})

target_link_libraries(proxy_common -lpthread ${PostgreSQL_LIBRARY})
