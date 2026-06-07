package com.clansocket.extractor.test;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSlider;
import javax.swing.JSpinner;
import javax.swing.SpinnerNumberModel;
import javax.swing.SwingConstants;

/**
 * Swing sidebar JFrame with toggles + sliders that mutate the shared
 * InspectorState. Runs on EDT; the GL render loop polls state.dirty per frame.
 */
public final class InspectorSidebar extends JFrame {

  private final InspectorState state;

  public InspectorSidebar(InspectorState state) {
    super("ClanSocket Model Inspector");
    this.state = state;

    JPanel root = new JPanel();
    root.setLayout(new BoxLayout(root, BoxLayout.Y_AXIS));
    root.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));

    root.add(buildItemSection());
    root.add(buildAngleSection());
    root.add(buildRenderSection());
    root.add(buildPrioritySection());

    setContentPane(root);
    setSize(360, 700);
    setDefaultCloseOperation(EXIT_ON_CLOSE);
    setLocation(20, 20);
    setVisible(true);
  }

  private JPanel section(String title) {
    JPanel p = new JPanel();
    p.setLayout(new BoxLayout(p, BoxLayout.Y_AXIS));
    p.setBorder(BorderFactory.createTitledBorder(title));
    p.setAlignmentX(LEFT_ALIGNMENT);
    return p;
  }

  private JPanel buildItemSection() {
    JPanel p = section("Item");
    JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 4));
    row.add(new JLabel("ID:"));
    JSpinner idSpinner = new JSpinner(new SpinnerNumberModel(state.itemId, 0, 99999, 1));
    idSpinner.setPreferredSize(new Dimension(100, 24));
    idSpinner.addChangeListener(e -> {
      state.itemId = (Integer) idSpinner.getValue();
      state.touchReload();
    });
    row.add(idSpinner);
    JButton reload = new JButton("Reload");
    reload.addActionListener(e -> state.touchReload());
    row.add(reload);
    p.add(row);
    return p;
  }

  private JPanel buildAngleSection() {
    JPanel p = section("Camera (RS2 angle units, 0–2047)");
    p.add(angleSlider("xan2d (X tilt)", 0, 2047, state.xan2d, v -> {
      state.xan2d = v;
      state.touchDirty();
    }));
    p.add(angleSlider("yan2d (Y rotation)", 0, 2047, state.yan2d, v -> {
      state.yan2d = v;
      state.touchDirty();
    }));
    p.add(angleSlider("zan2d (Z roll)", 0, 2047, state.zan2d, v -> {
      state.zan2d = v;
      state.touchDirty();
    }));
    return p;
  }

  private JPanel angleSlider(String label, int min, int max, int init, IntConsumer setter) {
    JPanel row = new JPanel();
    row.setLayout(new BoxLayout(row, BoxLayout.X_AXIS));
    JLabel l = new JLabel(label + ": " + init);
    l.setPreferredSize(new Dimension(170, 22));
    JSlider s = new JSlider(min, max, init);
    s.addChangeListener(e -> {
      setter.accept(s.getValue());
      l.setText(label + ": " + s.getValue());
    });
    row.add(l);
    row.add(s);
    return row;
  }

  private JPanel buildRenderSection() {
    JPanel p = section("Render flags");
    p.add(checkbox("priority sort + GL_LEQUAL", state.glLequal && state.prioritySort, v -> {
      state.glLequal = v;
      state.prioritySort = v;
      state.touchDirty();
    }));
    p.add(checkbox("dual-side lighting (gl_FrontFacing)", state.dualColor, v -> {
      state.dualColor = v;
      state.touchDirty();
    }));
    p.add(checkbox("alpha blending (GL_BLEND)", state.alphaBlend, v -> {
      state.alphaBlend = v;
      state.touchDirty();
    }));
    p.add(checkbox("depth write enabled", state.depthWrite, v -> {
      state.depthWrite = v;
      state.touchDirty();
    }));
    p.add(checkbox("GL_CULL_FACE", state.cullFace, v -> {
      state.cullFace = v;
      state.touchDirty();
    }));
    p.add(checkbox("wireframe", state.wireframe, v -> {
      state.wireframe = v;
      state.touchDirty();
    }));

    JPanel cullRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 4));
    cullRow.add(new JLabel("Cull direction:"));
    JComboBox<String> cull = new JComboBox<>(new String[]{"BACK", "FRONT"});
    cull.setSelectedIndex(state.cullDirection);
    cull.addActionListener(e -> {
      state.cullDirection = cull.getSelectedIndex();
      state.touchDirty();
    });
    cullRow.add(cull);
    p.add(cullRow);

    p.add(angleSlider("priorityZStep", 0, 20, state.priorityZStep, v -> {
      state.priorityZStep = v;
      state.touchDirty();
    }));

    return p;
  }

  private JPanel buildPrioritySection() {
    JPanel p = section("Priority isolation");
    p.add(new JLabel("Show only priority N (-1 = all):"));
    JPanel row = new JPanel(new GridLayout(2, 9, 4, 4));
    for (int i = -1; i <= 15; i++) {
      int pri = i;
      JButton b = new JButton(i == -1 ? "all" : String.valueOf(i));
      b.setMargin(new java.awt.Insets(2, 2, 2, 2));
      b.addActionListener(e -> {
        state.isolatePriority = pri;
        state.touchDirty();
      });
      row.add(b);
    }
    p.add(row);
    p.add(Box.createVerticalStrut(8));
    p.add(new JLabel("(Click a number to render only that priority group.)"));
    return p;
  }

  private JCheckBox checkbox(String label, boolean init, BoolConsumer setter) {
    JCheckBox c = new JCheckBox(label, init);
    c.addActionListener(e -> setter.accept(c.isSelected()));
    return c;
  }

  @FunctionalInterface
  interface IntConsumer { void accept(int v); }
  @FunctionalInterface
  interface BoolConsumer { void accept(boolean v); }
}
