cmake_minimum_required(VERSION 3.7)
project(module_net_port_client C)

set(CMAKE_C_STANDARD 11)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

set(VERSION_MAJOR 0)
set(VERSION_MINOR 0)
set(VERSION_PATCH 0)
set(BUILD_REVISION 1)
set(SOFT_VERSION ${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH})
set(MODULE_NAME module_net_port_client)

include(generate_product_version)
generate_product_version(
        VersionFilesOutputVariable
        NAME ${MODULE_NAME}
        VERSION_MAJOR ${VERSION_MAJOR}
        VERSION_MINOR ${VERSION_MINOR}
        VERSION_PATCH ${VERSION_PATCH}
        VERSION_REVISION ${BUILD_REVISION}
)

set(EXEC_NAME ${MODULE_NAME}-${SOFT_VERSION})

set(CMAKE_SYSTEM_NAME Linux)

# set(CMAKE_C_COMPILER arm-linux-gnueabihf-gcc)
# set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)
set(PostgreSQL_LIBRARY /usr/lib/x86_64-linux-gnu/libpq.so)
set(PostgreSQL_INCLUDE_DIRS "\\usr\\include\\postgresql")

link_directories(${PostgreSQL_LIBRARY_DIRS})

# feature checks
include(CheckLibraryExists)
check_library_exists(rt clock_gettime "time.h" CONFIG_SYSTEM_HAS_CLOCK_GETTIME)

# check if we are on a little or a big endian
include(TestBigEndian)
test_big_endian(PLATFORM_IS_BIGENDIAN)

include_directories(
        .
        ${PostgreSQL_INCLUDE_DIRS}
        ${CMAKE_CURRENT_LIST_DIR}/proxy/inc
        ${CMAKE_CURRENT_LIST_DIR}/resources/inc
        ${PROJECT_BINARY_DIR}
)

add_executable(${EXEC_NAME}
        main.c
        proxy/server/proxy_server.c
        resources/signal_handler.c
        resources/time_counter.c
)

target_link_libraries(${EXEC_NAME}
        proxy_common
        -lrt
)
