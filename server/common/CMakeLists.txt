cmake_minimum_required(VERSION 3.10)
set(CMAKE_C_STANDARD 11)

set(proxy_common_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/log/logMsg.c
        ${CMAKE_CURRENT_LIST_DIR}/db/db.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/memory/lib_memory.c
)

set(proxy_common_linux_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/hal/time/unix/time.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/thread/linux/thread_linux.c
)

# OS detection
if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    set(PostgreSQL_LIBRARY -lpq)
    set(PostgreSQL_INCLUDE_DIRS "/usr/local/opt/libpq/include")
    set(PostgreSQL_LIBRARY_DIRS "/usr/local/opt/libpq/lib")
else()
    # Assume Linux
    set(PostgreSQL_LIBRARY /usr/lib/x86_64-linux-gnu/libpq.so)
    set(PostgreSQL_INCLUDE_DIRS "/usr/include/postgresql")
    set(PostgreSQL_LIBRARY_DIRS "/usr/lib/x86_64-linux-gnu")
endif()

link_directories(${PostgreSQL_LIBRARY_DIRS})

include_directories(
        .
        ${PostgreSQL_INCLUDE_DIRS}
        ${CMAKE_CURRENT_LIST_DIR}/inc
)

include(GenerateExportHeader)

add_library(server_proxy_common ${proxy_common_SRCS} ${proxy_common_linux_SRCS})

target_link_libraries(server_proxy_common -lpthread ${PostgreSQL_LIBRARY})
