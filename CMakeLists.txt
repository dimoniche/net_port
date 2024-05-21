cmake_minimum_required(VERSION 3.7)

project(project_net_port C)

set(CMAKE_C_STANDARD 11)

if(NOT CMAKE_BUILD_TYPE)
        set(CMAKE_BUILD_TYPE Debug)
endif()

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/server)
add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/client)
