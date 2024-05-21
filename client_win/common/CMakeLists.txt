cmake_minimum_required(VERSION 3.7)
set(CMAKE_C_STANDARD 11)

set(CMAKE_SYSTEM_NAME Windows)

set(proxy_common_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/log/logMsg.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/memory/lib_memory.c
)

set(proxy_common_windows_SRCS
        ${CMAKE_CURRENT_LIST_DIR}/hal/time/win32/time.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/time/win32/get_time.c
        ${CMAKE_CURRENT_LIST_DIR}/hal/thread/win32/thread_win32.c
)

include_directories(
        .
        ${CMAKE_CURRENT_LIST_DIR}/inc
)

include(GenerateExportHeader)

add_library(client_proxy_common ${proxy_common_SRCS} ${proxy_common_windows_SRCS})

target_link_libraries(client_proxy_common 
                        #-lpthread
                     )
