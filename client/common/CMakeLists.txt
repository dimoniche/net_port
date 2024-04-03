cmake_minimum_required(VERSION 3.7)
set(CMAKE_C_STANDARD 11)

set(CMAKE_SYSTEM_NAME Linux)

set(proxy_common_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/log/logMsg.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/memory/lib_memory.c
)

set(proxy_common_linux_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/hal/time/unix/time.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/thread/linux/thread_linux.c
)

include_directories(
        .
        ${CMAKE_CURRENT_LIST_DIR}/inc
)

include(GenerateExportHeader)

add_library(client_proxy_common ${proxy_common_SRCS} ${proxy_common_linux_SRCS})

target_link_libraries(client_proxy_common -lpthread)
