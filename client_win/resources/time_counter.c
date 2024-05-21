//
// Created by chistyakov_ds on 19.12.2023.
//

static int counter_task_time = 0;

int get_time_counter()
{
  return counter_task_time;
}

void set_time_counter(int counter)
{
  counter_task_time = counter;
}

void increment_time_counter()
{
  counter_task_time++;
}