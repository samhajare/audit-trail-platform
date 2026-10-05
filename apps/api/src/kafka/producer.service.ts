import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Kafka, Partitioners, Producer } from 'kafkajs';
import { config } from '../config/config';

@Injectable()
export class KafkaProducerService implements OnApplicationShutdown {
  private readonly producer: Producer = new Kafka({
    clientId: 'audit-api',
    brokers: config.KAFKA_BROKERS.split(','),
  }).producer({ idempotent: true, createPartitioner: Partitioners.DefaultPartitioner });
  private connecting?: Promise<void>;

  private ensureConnected(): Promise<void> {
    // connect lazily so the API can boot (and serve reads) while Kafka is down
    this.connecting ??= this.producer.connect().catch((e) => {
      this.connecting = undefined;
      throw e;
    });
    return this.connecting;
  }

  async send(topic: string, key: string, value: string, headers: Record<string, string> = {}) {
    await this.ensureConnected();
    await this.producer.send({ topic, messages: [{ key, value, headers }] });
  }

  async onApplicationShutdown() {
    if (this.connecting) await this.producer.disconnect();
  }
}
